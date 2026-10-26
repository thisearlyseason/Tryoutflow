/** In-memory, read-only PostgREST-shaped fixture. No network, SQL, credentials or persistence. */
export const ids = {
  organization: '91000000-0000-4000-8000-000000000001',
  user: '91000000-0000-4000-8000-000000000002',
  tryout: '91000000-0000-4000-8000-000000000003',
  athlete: '91000000-0000-4000-8000-000000000004',
  session: '91000000-0000-4000-8000-000000000005',
  division: '91000000-0000-4000-8000-000000000006',
};
export type FixtureState = {
  tables: Record<string, Record<string, unknown>[]>;
  rpcs: Record<string, unknown>;
  tableErrors: Record<string, string>;
  calls: { table?: string; rpc?: string; operation: string; args: unknown[] }[];
  user: { id: string; email: string } | null;
};
export function readOnlyFictionalClient(state: FixtureState) {
  return {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    rpc: (rpc: string, args: unknown) => {
      state.calls.push({ rpc, operation: 'rpc', args: [args] });
      const value = state.rpcs[rpc];
      const result =
        value && typeof value === 'object' && '__fixtureErrorCode' in value
          ? { data: null, error: { code: value.__fixtureErrorCode } }
          : Object.hasOwn(state.rpcs, rpc)
            ? { data: value, error: null }
            : { data: null, error: new Error(`Unconfigured fictional RPC: ${rpc}`) };
      const response = Promise.resolve(result);
      return Object.assign(response, {
        limit: () => response,
        range: () => response,
        maybeSingle: async () => ({
          ...result,
          data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
        }),
      });
    },
    from(table: string) {
      let rows = [...(state.tables[table] ?? [])];
      let singular = false;
      let selected = '*';
      const project = (row: Record<string, unknown>) => {
        if (selected === '*' || selected.includes('*,') || selected.includes(',*')) return row;
        const columns = selected.split(/,(?![^()]*\))/);
        return Object.fromEntries(
          columns.flatMap((column) => {
            const key = column.trim().split('(')[0]!.split('!')[0]!;
            return Object.hasOwn(row, key) ? [[key, row[key]]] : [];
          }),
        );
      };
      const target: Record<string, unknown> = {};
      const result = () => ({
        data: state.tableErrors[table]
          ? null
          : singular
            ? rows[0]
              ? project(rows[0])
              : null
            : rows.map(project),
        error: state.tableErrors[table] ? new Error(state.tableErrors[table]) : null,
        count: rows.length,
      });
      const query = new Proxy(target, {
        get(_target, operation: string) {
          if (operation === 'then')
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(result()).then(resolve, reject);
          if (operation === 'single' || operation === 'maybeSingle')
            return () => {
              singular = true;
              return Promise.resolve(result());
            };
          if (['insert', 'update', 'upsert', 'delete'].includes(operation))
            return () => {
              throw new Error(`Fixture forbids write: ${table}.${operation}`);
            };
          return (...args: unknown[]) => {
            state.calls.push({ table, operation, args });
            if (operation === 'select') selected = String(args[0] ?? '*');
            if (operation === 'eq') rows = rows.filter((row) => row[String(args[0])] === args[1]);
            if (operation === 'neq') rows = rows.filter((row) => row[String(args[0])] !== args[1]);
            if (operation === 'is')
              rows = rows.filter((row) => (row[String(args[0])] ?? null) === args[1]);
            if (operation === 'in')
              rows = rows.filter((row) => (args[1] as unknown[]).includes(row[String(args[0])]));
            if (operation === 'limit') rows = rows.slice(0, Number(args[0]));
            if (operation === 'range') rows = rows.slice(Number(args[0]), Number(args[1]) + 1);
            return query;
          };
        },
      });
      return query;
    },
  };
}
