// Middleware to proxy /api/* requests to the Worker backend
export async function onRequest(context) {
  const url = new URL(context.request.url);
  
  // Only proxy /api/* requests
  if (!url.pathname.startsWith('/api/')) {
    return context.next();
  }
  
  const targetUrl = 'https://fitness.kc-labs.workers.dev' + url.pathname + url.search;
  
  // Clone headers, remove host
  const headers = new Headers(context.request.headers);
  headers.delete('host');
  headers.set('X-Forwarded-Host', url.host);
  
  try {
    const response = await fetch(targetUrl, {
      method: context.request.method,
      headers,
      body: context.request.method !== 'GET' && context.request.method !== 'HEAD' 
        ? context.request.body 
        : undefined,
    });
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err) {
    return new Response('Proxy error: ' + err.message, { status: 502 });
  }
}
