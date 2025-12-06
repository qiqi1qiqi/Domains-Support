import { Env } from '../../types'

export const onRequestPost: PagesFunction<Env> = async (context) => {
    try {
        const { domain } = await context.request.json() as { domain: string }

        let isOnline = false
        // 检查网站连通性，最多重试3次
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const controller = new AbortController()
                const timeoutPromise = new Promise<Response>((_, reject) => {
                    setTimeout(() => {
                        controller.abort()
                        reject(new Error('Timeout'))
                    }, 5000) // 增加超时时间到 5 秒
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
                        if (response.status < 520 || response.status === 530) {
                            isOnline = true
                            break
                        }
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
                                isOnline = true
                                break
                            }
                        }
                    } catch (httpError) {
                        console.error(`HTTP 检查域名 ${domain} 失败（第${attempt}次）:`, httpError)
                    }
                }
            } catch (error) {
                console.error(`检查域名 ${domain} 失败（第${attempt}次）:`, error)
            }
        }

        return Response.json({
            status: 200,
            message: '检查完成',
            data: { status: isOnline ? '在线' : '离线' }
        })
    } catch (error) {
        console.error('域名检查失败:', error)
        return Response.json({
            status: 500,
            message: error instanceof Error ? error.message : '检查失败',
            data: null
        }, { status: 500 })
    }
}