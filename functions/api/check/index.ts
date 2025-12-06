import type { Env } from '../../types'

interface AlertConfig {
    tg_token: string
    tg_userid: string
    wx_api: string
    wx_token: string
    days: number
}

interface Domain {
    domain: string
    expiry_date: string
    tgsend: number
    st_tgsend: number
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
    try {
        // 验证 API Token
        const url = new URL(context.request.url)
        const tokenParam = url.searchParams.get('token')
        const authHeader = context.request.headers.get('Authorization')
        const headerToken = authHeader?.replace('Bearer ', '')

        // 同时支持查询参数和 Bearer Token
        const token = tokenParam || headerToken

        if (!token || token !== context.env.API_TOKEN) {
            return Response.json({
                status: 401,
                message: '未授权访问',
                data: null
            }, { status: 401 })
        }

        console.log('开始执行域名检查...')
        const { results: configResults } = await context.env.DB.prepare(
            'SELECT * FROM alertcfg LIMIT 1'
        ).all<AlertConfig>()

        if (!configResults.length) {
            console.log('未找到告警配置')
            return Response.json({
                status: 404,
                message: '未找到告警配置',
                data: null
            }, { status: 404 })
        }

        const config = configResults[0]
        console.log('获取到告警配置:', {
            days: config.days,
            has_token: !!config.tg_token,
            has_userid: !!config.tg_userid
        })

        // 获取所有域名
        const { results: domains } = await context.env.DB.prepare(
            'SELECT domain, expiry_date, tgsend, st_tgsend FROM domains WHERE tgsend = 1 or st_tgsend = 1'
        ).all<Domain>()

        console.log(`找到 ${domains.length} 个启用通知的域名`)
        const notifiedDomains: any[] = []

        // 批量检查域名状态
        const BATCH_SIZE = 5
        for (let i = 0; i < domains.length; i += BATCH_SIZE) {
            const batch = domains.slice(i, i + BATCH_SIZE)
            console.log(`正在处理第 ${i + 1} 到 ${Math.min(i + BATCH_SIZE, domains.length)} 个域名`)

            await Promise.all(batch.map(async (domain) => {
                const remainingDays = calculateRemainingDays(domain.expiry_date)
                console.log(`检查域名 ${domain.domain}: 过期时间 ${domain.expiry_date}, 剩余天数 ${remainingDays}`)

                // 检查网站连通性
                const isOnline = await checkDomainStatus(domain.domain)

                // 更新域名状态
                const newStatus = isOnline ? '在线' : '离线'
                await context.env.DB.prepare(
                    'UPDATE domains SET status = ? WHERE domain = ?'
                ).bind(newStatus, domain.domain).run()

                // 如果状态变为离线且启用了通知，发送通知
                if (newStatus === '离线' && domain.st_tgsend === 1) {
                    const message = `*🔔 Domains-Support 通知*\n\n` +
                        `⚠️ *域名服务离线告警*\n\n` +
                        `🌐 域名：\`${domain.domain}\`\n` +
                        `📊 状态：离线\n` +
                        `⏰ 时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n` +
                        `🔍 请检查网站服务状态！`

                    try {
                        if (config.tg_token && config.tg_userid) {
                            await sendTelegramMessage(config.tg_token, config.tg_userid, message)
                            console.log(`成功发送离线通知 (Telegram)：${domain.domain}`)
                        }
                        if (config.wx_api && config.wx_token) {
                            await sendWeChatMessage(config.wx_api, config.wx_token, '来自Domain-Support通知', message)
                            console.log(`成功发送离线通知 (WeChat)：${domain.domain}`)
                        }
                    } catch (error) {
                        console.error(`发送离线通知失败:`, error)
                    }
                }

                // 检查域名是否即将过期
                if (remainingDays <= config.days && domain.tgsend === 1) {
                    console.log(`域名 ${domain.domain} 需要发送过期通知：剩余天数(${remainingDays}) <= 阈值(${config.days})`)
                    const message = `*🔔 Domains-Support通知*\n\n` +
                        `🌐 域名：\`${domain.domain}\`\n` +
                        `📅 过期时间：\`${domain.expiry_date}\`\n` +
                        `⏳ 剩余天数：\`${remainingDays}天\`\n\n` +
                        `⚠️ 剩余天数告警，请尽快进行续约！`

                    try {
                        console.log('准备发送过期通知...')
                        if (config.tg_token && config.tg_userid) {
                            await sendTelegramMessage(config.tg_token, config.tg_userid, message)
                            console.log(`成功发送过期通知 (Telegram)：${domain.domain}`)
                        }
                        if (config.wx_api && config.wx_token) {
                            await sendWeChatMessage(config.wx_api, config.wx_token, '来自Domain-Support通知', message)
                            console.log(`成功发送过期通知 (WeChat)：${domain.domain}`)
                        }
                        notifiedDomains.push({
                            domain: domain.domain,
                            remainingDays,
                            expiry_date: domain.expiry_date
                        })
                    } catch (error) {
                        console.error(`发送过期通知失败:`, error)
                    }
                }
            }))
        }

        return Response.json({
            status: 200,
            message: '检查完成',
            data: {
                total_domains: domains.length,
                notified_domains: notifiedDomains
            }
        })
    } catch (error) {
        console.error('检查执行失败:', error)
        return Response.json({
            status: 500,
            message: '检查执行失败: ' + (error as Error).message,
            data: null
        }, { status: 500 })
    }
}

// 添加对 GET 方法的支持
export const onRequestGet: PagesFunction<Env> = onRequestPost

function calculateRemainingDays(expiryDate: string): number {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const expiry = new Date(expiryDate)
    expiry.setHours(0, 0, 0, 0)
    const diffTime = expiry.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return Math.max(0, diffDays)
}

async function checkDomainStatus(domain: string): Promise<boolean> {
    // 检查网站连通性，最多重试3次
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const controller = new AbortController()
            const timeoutPromise = new Promise<Response>((_, reject) => {
                setTimeout(() => {
                    controller.abort()
                    reject(new Error('Timeout'))
                }, 10000) // 增加超时时间到 10 秒
            })

            // 优先尝试 HTTPS
            const httpsFetchPromise = fetch(`https://${domain}`, {
                method: 'GET',
                redirect: 'follow',
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'close',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1'
                }
            })

            try {
                const response = await Promise.race([httpsFetchPromise, timeoutPromise])
                if (response instanceof Response) {
                    // 放宽判定标准：只要状态码小于 520 (Cloudflare Origin Error) 或等于 530 (DNS Error) 都算在线
                    // 530 通常是 Cloudflare 1xxx 错误，可能是 Worker 访问受限，但说明域名解析正常
                    if (response.status < 520 || response.status === 530) {
                        return true
                    }
                    console.log(`域名 ${domain} HTTPS 返回状态码: ${response.status}`)
                }
            } catch (httpsError) {
                console.error(`HTTPS 检查域名 ${domain} 失败（第${attempt}次）:`, httpsError)
                
                // 如果 HTTPS 失败，尝试 HTTP
                const httpFetchPromise = fetch(`http://${domain}`, {
                    method: 'GET',
                    redirect: 'follow',
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'close',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1'
                    }
                })

                try {
                    const response = await Promise.race([httpFetchPromise, timeoutPromise])
                    if (response instanceof Response) {
                        if (response.status < 520 || response.status === 530) {
                            return true
                        }
                        console.log(`域名 ${domain} HTTP 返回状态码: ${response.status}`)
                    }
                } catch (httpError) {
                    console.error(`HTTP 检查域名 ${domain} 失败（第${attempt}次）:`, httpError)
                }
            }
        } catch (error) {
            console.error(`检查域名 ${domain} 失败（第${attempt}次）:`, error)
        }
        // 如果本次未成功，自动进入下一次重试
    }
    console.log(`域名 ${domain} 最终检查结果: 离线`)
    return false
}

async function sendTelegramMessage(token: string, chatId: string, message: string): Promise<void> {
    if (!token || !chatId) {
        throw new Error('Telegram token 或 chat ID 未配置')
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`
    console.log('发送 Telegram 请求:', { url, chatId, messageLength: message.length })

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown',
        }),
    })

    const responseData = await response.json()

    if (!response.ok) {
        console.error('Telegram API 响应错误:', responseData)
        throw new Error(`Failed to send Telegram message: ${response.statusText}, Details: ${JSON.stringify(responseData)}`)
    }

    console.log('Telegram API 响应:', responseData)
}

async function sendWeChatMessage(apiUrl: string, token: string, title: string, text: string): Promise<void> {
    if (!apiUrl || !token) {
        console.log('WeChat API URL 或 token 未配置，跳过发送');
        return;
    }

    console.log('准备发送 WeChat 消息:', { url: apiUrl, title, textLength: text.length });
    const body = `title=${encodeURIComponent(title)}&content=${encodeURIComponent(text)}&token=${encodeURIComponent(token)}`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body,
        });

        const responseData = await response.json();

        if (!response.ok) {
            console.error('WeChat API 响应错误:', responseData);
        } else {
            console.log('WeChat API 响应:', responseData);
        }
    } catch (error) {
        console.error('发送 WeChat 消息失败:', error);
    }
}