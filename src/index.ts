interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * GovData.de MCP — Germany's national open-data portal (CKAN API).
 *
 * GovData (govdata.de) is the German federal data portal ("Datenportal für
 * Deutschland"). It federates open datasets published by federal, state
 * (Länder) and municipal authorities. Auth: none (keyless).
 * Docs: https://docs.ckan.org/en/latest/api/  (stock CKAN action API).
 *
 * Notes for callers:
 * - Almost all metadata (dataset titles, descriptions, organization display
 *   names, group names) is in GERMAN (UTF-8). Free-text `query`/`q` arguments
 *   may be passed in German or English; German keywords match far more
 *   datasets. e.g. "Verkehr" (transport), "Haushalt" (budget), "Umwelt"
 *   (environment), "Gesundheit" (health). Records come back as UTF-8 JSON.
 * - GovData is a metadata aggregator: most resources link out to files on the
 *   publishing authority's own portal rather than hosting tabular data, so the
 *   CKAN datastore is generally NOT active here. There is therefore no
 *   datastore_query tool — fetch a dataset's resource URLs via dataset_details
 *   and read the underlying file directly.
 */


const BASE = 'https://www.govdata.de/ckan/api/3/action';
const UA = 'pipeworx-mcp-govdata-de/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_datasets',
    description:
      'Search the GovData.de catalogue (CKAN package_search) — German federal/state/municipal open data. Returns matching datasets with titles/descriptions (mostly German). Query may be German or English; German keywords match more.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms, German or English. e.g. "Verkehr", "Umwelt", "Haushalt", "health".' },
        fq: { type: 'string', description: 'Solr filter query, e.g. "organization:bund" or "res_format:CSV" or "groups:gesu".' },
        rows: { type: 'number', description: 'Max results, 1-1000 (default 25).' },
        start: { type: 'number', description: '0-based offset for paging.' },
        sort: { type: 'string', description: 'Sort spec, e.g. "metadata_modified desc".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'dataset_details',
    description:
      'Full dataset record by id or slug (CKAN package_show), including its resources. Read each resource\'s "url" to download the underlying file (CSV/JSON/etc.) — GovData links out to the publishing authority rather than hosting tabular data.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Dataset id (UUID) or slug from search_datasets results.' } },
      required: ['id'],
    },
  },
  {
    name: 'list_organizations',
    description: 'List publishing organizations (federal ministries, Länder, municipalities, agencies) on GovData.de (CKAN organization_list).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max orgs, 1-1000 (default 100).' } },
    },
  },
  {
    name: 'list_groups',
    description: 'List thematic groups/categories on GovData.de (CKAN group_list), e.g. transport, environment, health, education.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max groups, 1-1000 (default 100).' } },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_datasets': {
      const params = new URLSearchParams({
        q: reqStr(args, 'query', '"Verkehr" or "health"'),
        rows: String(clamp(args.rows, 25, 1, 1000)),
        start: String(Math.max(0, (args.start as number) ?? 0)),
      });
      if (args.fq) params.set('fq', String(args.fq));
      if (args.sort) params.set('sort', String(args.sort));
      return ckanGet(`/package_search?${params}`);
    }
    case 'dataset_details':
      return ckanGet(`/package_show?id=${encodeURIComponent(reqStr(args, 'id', 'a dataset id or slug'))}`);
    case 'list_organizations': {
      const params = new URLSearchParams({ all_fields: 'true', limit: String(clamp(args.limit, 100, 1, 1000)) });
      return ckanGet(`/organization_list?${params}`);
    }
    case 'list_groups': {
      const params = new URLSearchParams({ all_fields: 'true', limit: String(clamp(args.limit, 100, 1, 1000)) });
      return ckanGet(`/group_list?${params}`);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function ckanGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GovData: ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  const json = (await res.json()) as { success?: boolean; error?: { message?: string }; result?: unknown };
  if (json.success === false) throw new Error(`GovData: ${json.error?.message ?? 'request failed'}`);
  return json.result ?? json;
}

function clamp(v: unknown, dflt: number, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : dflt;
  return Math.min(hi, Math.max(lo, n));
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
