const offset = Number(process.env.E2E_PORT_OFFSET ?? 0);
const slot = offset + Number(process.env.TEST_PARALLEL_INDEX ?? 0);

export const workers = Number(process.env.E2E_WORKERS ?? 4);
export const readyPort = 5172 + offset;
export const smokePort = 5184 + offset;
export const servicePorts = (i: number) => ({ web: 5173 + offset + i, api: 8787 + offset + i, inspector: 9229 + offset + i });
export const origin = `http://127.0.0.1:${5173 + slot}`;
export const api = `http://127.0.0.1:${8787 + slot}`;
