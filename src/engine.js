// engine.js
import express from 'express';
import jwt from 'jsonwebtoken';
import { operations } from './operations.js';
import { db, registro_auditoria } from './database.js';

const SKIP_AUDIT = new Set([
    'login', 'getSchema', 'query', 'listAuditoria',
    'listBancos', 'listUnidades', 'listCargos', 'listPersonas', 'listEmpleos',
    'listPlantilla', 'listSolicitudes', 'listAsistencia', 'listEventos',
    'listContratos', 'listCarnets', 'listActivos', 'listCapacitaciones',
    'listCasosDisciplinarios', 'listVacaciones',
    'searchPersona', 'getPersona', 'getContrato', 'getSaldoVacaciones',
    'getCapacitacionesPendientes',
]);

const app = express();
app.use((req, res, next) => {
    console.log(`← ${req.method} ${req.url} origin=${req.headers.origin || 'none'}`);
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
        console.log('  → 204 preflight OK');
        return res.sendStatus(204);
    }
    next();
});
app.use(express.json());
app.use('/downloads', express.static('downloads'));
app.use('/storage', express.static('storage'));
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET env variable is required');

app.use((req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    req.caller = null;
    if (token) try { req.caller = jwt.verify(token, SECRET); req.caller._token = token; } catch { }
    next();
});

app.post('/api/:operation', async (req, res) => {
    console.log(`  op=${req.params.operation} body=${JSON.stringify(req.body)} caller=${req.caller?.codigo || 'anon'}`);
    try {
        const handler = operations[req.params.operation];
        if (!handler) {
            console.log('  → 404 unknown operation');
            return res.status(404).json({ ok: false, error: 'unknown operation' });
        }
        const result = await handler({ input: req.body, caller: req.caller });
        console.log('  → ok');
        if (!SKIP_AUDIT.has(req.params.operation)) {
            db.insert(registro_auditoria).values({
                persona_id: req.caller?.codigo || null,
                operacion: req.params.operation,
                entidad_id: result?.id || result?.codigo ? String(result.id || result.codigo) : null,
                data: JSON.stringify(req.body),
            }).catch(() => {});
        }
        res.json({ ok: true, data: result });
    } catch (e) {
        console.log(`  → error: ${e.message}`);
        res.json({ ok: false, error: e.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Ready on port ${PORT} — all changes are picked up automatically`));