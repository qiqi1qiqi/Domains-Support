import { Env } from '../types'

export const onRequestGet: PagesFunction<Env> = async (context) => {
    const url = new URL(context.request.url)
    const domain = url.searchParams.get('domain')

    if (!domain) {
        return Response.json({ error: 'Missing domain parameter' }, { status: 400 })
    }

    const results = []

    // 1. HTTPS Check
    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)
        
        const startTime = Date.now()
        const response = await fetch(`https://${domain}`, {
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
        clearTimeout(timeoutId)
        const duration = Date.now() - startTime
        const text = await response.text()

        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => {
            headers[key] = value
        })

        results.push({
            protocol: 'HTTPS',
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            duration: `${duration}ms`,
            headers: headers,
            body: text.substring(0, 1000), // 只截取前1000个字符避免过大
            isOnline: response.status < 520
        })

    } catch (error) {
        results.push({
            protocol: 'HTTPS',
            error: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : 'UnknownError'
        })
    }

    // 2. HTTP Check (if HTTPS failed or just for info)
    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)
        
        const startTime = Date.now()
        const response = await fetch(`http://${domain}`, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Connection': 'close'
            }
        })
        clearTimeout(timeoutId)
        const duration = Date.now() - startTime

        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => {
            headers[key] = value
        })

        results.push({
            protocol: 'HTTP',
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            duration: `${duration}ms`,
            headers: headers,
            isOnline: response.status < 520
        })

    } catch (error) {
        results.push({
            protocol: 'HTTP',
            error: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : 'UnknownError'
        })
    }

    return Response.json({
        domain,
        timestamp: new Date().toISOString(),
        results
    }, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        }
    })
}
