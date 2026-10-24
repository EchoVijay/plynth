// jobs-api: authenticated proxy to freehire's public API (the API sends no CORS headers).
// POST { op: 'search'|'facets'|'job'|'similar'|'company'|'suggest', ... }

import { corsHeaders, json, userFromAuth } from '../_shared/util.ts';
import {
  UpstreamError, getCompany, getFacets, getJob, searchJobs, similarJobs, suggest,
} from '../_shared/freehire.ts';
import { sanitizeFilters } from '../_shared/pure/job-filters.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const user = await userFromAuth(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body.op !== 'string') return json({ error: 'op required' }, 400);

  try {
    switch (body.op) {
      case 'search': {
        const r = await searchJobs(sanitizeFilters(body.filters), { limit: body.limit, offset: body.offset });
        return json({ data: r.jobs, meta: { total: r.total, limit: r.limit, offset: r.offset } });
      }
      case 'facets':
        return json({ data: await getFacets(sanitizeFilters(body.filters)) });
      case 'job':
        return json({ data: await getJob(String(body.slug ?? '')) });
      case 'similar':
        return json({ data: await similarJobs(String(body.slug ?? '')) });
      case 'company':
        return json({ data: await getCompany(String(body.slug ?? '')) });
      case 'suggest':
        return json({ data: await suggest(String(body.q ?? '')) });
      default:
        return json({ error: 'unknown op' }, 400);
    }
  } catch (e) {
    if (e instanceof UpstreamError) {
      const status = e.status === 404 ? 404 : e.status === 429 ? 429 : e.status >= 400 && e.status < 500 ? 400 : 502;
      return json({ error: e.message }, status);
    }
    return json({ error: String(e) }, 500);
  }
});
