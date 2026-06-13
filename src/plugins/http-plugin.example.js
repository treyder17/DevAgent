/**
 * DevAgent Plugin: HTTP Requester
 * 
 * Adds a `http_request` tool so DevAgent can make HTTP requests
 * (useful for testing APIs you're building).
 *
 * Install: da plugin add https://raw.githubusercontent.com/.../http-plugin.js
 *      or: da plugin add ./http-plugin.js
 */

export default {
  name: 'http-requester',
  version: '1.0.0',
  description: 'Makes HTTP requests to test your APIs directly from DevAgent',

  tools: [
    {
      name: 'http_request',
      description: `Make an HTTP request (GET, POST, PUT, DELETE, PATCH).
Use this to test REST API endpoints while developing. 
Supports JSON bodies and custom headers.`,
      input_schema: {
        type: 'object',
        properties: {
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            description: 'HTTP method',
          },
          url: {
            type: 'string',
            description: 'Full URL to request',
          },
          headers: {
            type: 'object',
            description: 'Optional HTTP headers as key-value pairs',
            additionalProperties: { type: 'string' },
          },
          body: {
            type: 'string',
            description: 'Request body (JSON string for JSON APIs)',
          },
        },
        required: ['method', 'url'],
      },

      handler: async (input, context) => {
        const { method, url, headers = {}, body } = input;
        const { ui } = context;

        const fetchOptions = {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
        };
        if (body && method !== 'GET') {
          fetchOptions.body = body;
        }

        try {
          const res = await fetch(url, fetchOptions);
          const text = await res.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch { parsed = text; }

          const output = [
            `Status: ${res.status} ${res.statusText}`,
            `Headers: ${JSON.stringify(Object.fromEntries(res.headers.entries()), null, 2)}`,
            `Body:\n${typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}`,
          ].join('\n\n');

          return { ok: res.ok, output };
        } catch (err) {
          return { ok: false, output: `Request failed: ${err.message}` };
        }
      },
    },
  ],
};
