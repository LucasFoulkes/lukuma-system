// operations.js
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { eq, like, or, and, isNull, inArray, sql } from 'drizzle-orm';
import { db, persona, empleo, cargo, unidad, banco, alias, asistencia, plantilla, solicitud, documento, evento, sqlite,
         registro_auditoria, contrato, saldo_vacaciones, carnet, asignacion_activo, capacitacion, caso_disciplinario } from './database.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { hiring } from './processes/hiring.js';

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET env variable is required');
const TALENTO_HUMANO_ID = 'daad7b97';
const LUCAS_ID = 100649;
const FRANCESCO_ID = 200051;

// --- Helpers ---

function requireAuth(caller) {
    if (!caller) throw new Error('not authenticated');
}

function requireAdmin(caller) {
    requireAuth(caller);
    if (caller.codigo !== LUCAS_ID) throw new Error('unauthorized');
}

function requireId(input, field = 'id') {
    if (!input[field]) throw new Error(`${field} is required`);
}

function buildUnitPathById(unidadId, unidadById) {
    if (!unidadId) return null;
    const parts = [];
    const seen = new Set();
    let current = unidadById.get(unidadId);
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        parts.push(current.nombre);
        current = unidadById.get(current.parent_id);
    }
    return parts.reverse().join(' > ');
}

const CRUD_DOCS = {
    listBancos: 'List all banks. Input: none. Output: array of {id: string, nombre: string}.',
    createBanco: 'Create a bank. Input: id (string), nombre (string). Output: the created banco row.',
    updateBanco: 'Update a bank. Input: id (string, required), nombre (string, optional). Output: the updated banco row.',
    listUnidades: 'List all organizational units. Input: none. Output: array of {id, nombre, tipo, parent_id}.',
    createUnidad: 'Create an organizational unit. Input: id (string), nombre (string), tipo (string), parent_id (string, optional). Output: the created unidad row.',
    updateUnidad: 'Update an organizational unit. Input: id (string, required), nombre, tipo, parent_id. Output: the updated unidad row.',
    listCargos: 'List all job positions. Input: none. Output: array of {id, rol_base, especialidad, codigo_iess}.',
    createCargo: 'Create a job position. Input: id (string), rol_base (string), especialidad (string), codigo_iess (string). Output: the created cargo row.',
    updateCargo: 'Update a job position. Input: id (string, required), rol_base, especialidad, codigo_iess. Output: the updated cargo row.',
    listPersonas: 'List all people. Input: none. Output: array of persona rows.',
    listEmpleos: 'List all employment records. Input: none. Output: array of empleo rows.',
    createEmpleo: 'Create an employment record. Input: id, persona_id, cargo_id, unidad_id, tipo_contrato, fecha_inicio, and optional fields. Output: the created empleo row.',
    updateEmpleo: 'Update an employment record. Input: id (string, required), plus any empleo fields. Output: the updated empleo row.',
    updatePlantilla: 'Update a staffing requirement. Input: id (string, required), cantidad_minima (number). Output: the updated plantilla row.',
    listSolicitudes: 'List all solicitudes. Input: none. Output: array of solicitud rows {id, tipo, caller_id, data, estado, created_at}.',
};

function getOperationDocs() {
    const pattern = /(\w+):\s*async function \w+\([^)]*\)\s*\{\s*\/\*\*([\s\S]*?)\*\//g;
    const docs = { ...CRUD_DOCS };
    for (const file of ['./operations.js', './processes/hiring.js']) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8');
        for (const match of source.matchAll(pattern)) {
            docs[match[1]] = match[2].replace(/\s*\*\s?/g, ' ').trim();
        }
    }
    return docs;
}

// --- Simple CRUD factory ---

function crudList(table) {
    return async function ({ caller }) {
        requireAuth(caller);
        return db.select().from(table);
    };
}

function crudCreate(table) {
    return async function ({ input, caller }) {
        requireAuth(caller);
        const [row] = await db.insert(table).values(input).returning();
        return row;
    };
}

function crudUpdate(table, idField = 'id') {
    return async function ({ input, caller }) {
        requireAuth(caller);
        const idValue = input[idField];
        if (!idValue) throw new Error(`${idField} is required`);
        const { [idField]: _, ...data } = input;
        const [row] = await db.update(table).set(data).where(eq(table[idField], idValue)).returning();
        return row;
    };
}

// --- Merge-update helper for JSON data columns ---

async function mergeJsonUpdate(table, id, input, { dateField } = {}) {
    const [existing] = await db.select().from(table).where(eq(table.id, id));
    if (!existing) throw new Error('record not found');
    const { id: _, ...fields } = input;
    const merged = { ...JSON.parse(existing.data), ...fields };
    const updates = { data: JSON.stringify(merged), updated_at: new Date().toISOString() };
    if (dateField && input[dateField]) updates[dateField] = input[dateField];
    const [row] = await db.update(table).set(updates).where(eq(table.id, id)).returning();
    return row;
}

export const operations = {

    // ─── SQL ────────────────────────────────────────────────────────────────
    query: async function query({ input, caller }) {
        /**
         * Execute raw SQL (admin only).
         * Input: sql (string) — the SQL statement, params (string[]) — bind parameters.
         * Output: array of rows for SELECT, or {changes, lastInsertRowid} for writes.
         */
        requireAdmin(caller);
        if (!input.sql) throw new Error('sql is required');
        const stmt = sqlite.prepare(input.sql);
        if (stmt.reader) {
            return stmt.all(...(input.params || []));
        }
        return stmt.run(...(input.params || []));
    },

    // ─── Schema ─────────────────────────────────────────────────────────────
    getSchema: async function getSchema({ caller }) {
        /**
         * Get database schema.
         * Input: none.
         * Output: array of {table: string, columns: [{name, type, notnull, pk}]}.
         */
        requireAuth(caller);
        const tables = sqlite.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`
        ).all();
        return tables.map(t => ({
            table: t.name,
            columns: sqlite.prepare(`PRAGMA table_info('${t.name}')`).all(),
        }));
    },

    // ─── Auth ───────────────────────────────────────────────────────────────
    login: async function login({ input }) {
        /**
         * Authenticate user and return session.
         * Input: usuario (string), contrasena (string).
         * Output: {token: string, profile: persona with empleos[], schema: [{table, columns}], operations: [{name, description}]}.
         */
        const { usuario, contrasena } = input;
        if (!usuario || !contrasena) throw new Error('usuario and contrasena are required');
        const [p] = await db.select().from(persona)
            .where(eq(persona.usuario, usuario));
        if (!p) throw new Error('invalid credentials');
        const valid = await bcrypt.compare(contrasena, p.contrasena);
        if (!valid) throw new Error('invalid credentials');
        const token = jwt.sign({ codigo: p.codigo, nombres: p.nombres, apellidos: p.apellidos }, SECRET);
        const caller = { codigo: p.codigo };
        const profile = await operations.getPersona({ input: { id: p.codigo }, caller });
        const docs = getOperationDocs();
        const ops = Object.keys(operations)
            .map(name => ({ name, description: docs[name] || null }));
        const schema = await operations.getSchema({ caller });
        return { token, profile, schema, operations: ops };
    },

    // ─── Banco ───────────────────────────────────────────────────────────────
    listBancos: crudList(banco),
    createBanco: crudCreate(banco),
    updateBanco: crudUpdate(banco),

    // ─── Unidad ──────────────────────────────────────────────────────────────
    listUnidades: crudList(unidad),
    createUnidad: crudCreate(unidad),
    updateUnidad: crudUpdate(unidad),

    // ─── Cargo ───────────────────────────────────────────────────────────────
    listCargos: crudList(cargo),
    createCargo: crudCreate(cargo),
    updateCargo: crudUpdate(cargo),

    // ─── Persona ─────────────────────────────────────────────────────────────
    listPersonas: crudList(persona),

    searchPersona: async function searchPersona({ input, caller }) {
        /**
         * Search people by name (fuzzy, matches against nombres and apellidos).
         * Input: name (string) — search term, can be multiple words.
         * Output: array of persona rows (max 50).
         */
        requireAuth(caller);
        if (!input.name) throw new Error('name is required');
        const words = input.name.trim().split(/\s+/);
        const conditions = words.flatMap(
            word => [
                like(sql`UPPER(${persona.nombres})`, `%${word.toUpperCase()}%`),
                like(sql`UPPER(${persona.apellidos})`, `%${word.toUpperCase()}%`)
            ]
        );
        return db.select().from(persona).where(or(...conditions)).limit(50);
    },

    getPersona: async function getPersona({ input, caller }) {
        /**
         * Get a person with their employment details.
         * Input: id (number) — persona codigo.
         * Output: persona row + empleos[] (each with rol_base, especialidad, unidad, banco, unidad_path, etc).
         */
        requireAuth(caller);
        requireId(input, 'id');
        const [p] = await db.select().from(persona).where(eq(persona.codigo, input.id));
        if (!p) throw new Error('persona not found');
        const empleos = await db.select({
            id: empleo.id,
            rol_base: cargo.rol_base,
            especialidad: cargo.especialidad,
            unidad_id: empleo.unidad_id,
            unidad: unidad.nombre,
            banco: banco.nombre,
            tipo_contrato: empleo.tipo_contrato,
            fecha_inicio: empleo.fecha_inicio,
            fecha_fin: empleo.fecha_fin,
            numero_cuenta: empleo.numero_cuenta,
            alterno: empleo.alterno,
            perfil_horario: empleo.perfil_horario,
            estructura_costos: empleo.estructura_costos,
        }).from(empleo)
            .leftJoin(cargo, eq(empleo.cargo_id, cargo.id))
            .leftJoin(unidad, eq(empleo.unidad_id, unidad.id))
            .leftJoin(banco, eq(empleo.banco_id, banco.id))
            .where(eq(empleo.persona_id, input.id));
        const unidades = await db.select().from(unidad);
        const unidadById = new Map(unidades.map((u) => [u.id, u]));
        const empleosConRuta = empleos.map((row) => ({
            ...row,
            unidad_path: buildUnitPathById(row.unidad_id, unidadById),
        }));
        return { ...p, empleos: empleosConRuta };
    },

    createPersona: async function createPersona({ input, caller }) {
        /**
         * Create a person.
         * Input: cedula (number, required), nombres (string, required), apellidos (string, required), and optional fields: fecha_nacimiento, sexo, estado_civil, titulo, profesion, email, movil, telefono, contrasena, usuario, etc.
         * Output: the created persona row.
         */
        requireAuth(caller);
        if (input.contrasena) input.contrasena = await bcrypt.hash(input.contrasena, 10);
        const [row] = await db.insert(persona).values(input).returning();
        return row;
    },

    updatePersona: async function updatePersona({ input, caller }) {
        /**
         * Update a person.
         * Input: codigo (number, required), plus any persona fields to update.
         * Output: the updated persona row.
         */
        requireAuth(caller);
        const { codigo, ...data } = input;
        if (data.contrasena) data.contrasena = await bcrypt.hash(data.contrasena, 10);
        const [row] = await db.update(persona).set(data).where(eq(persona.codigo, codigo)).returning();
        return row;
    },

    // ─── Empleo ──────────────────────────────────────────────────────────────
    listEmpleos: crudList(empleo),
    createEmpleo: crudCreate(empleo),
    updateEmpleo: crudUpdate(empleo),

    // ─── Plantilla ───────────────────────────────────────────────────────────
    listPlantilla: async function listPlantilla({ caller }) {
        /**
         * List staffing plan with current headcount. Shows how many of each cargo are needed vs filled per unit.
         * Input: none.
         * Output: array of {id, cargo_id, rol_base, especialidad, unidad_id, unidad, cantidad_minima, actual} where actual is current empleo count.
         */
        requireAuth(caller);
        const rows = await db.select({
            id: plantilla.id,
            cargo_id: plantilla.cargo_id,
            rol_base: cargo.rol_base,
            especialidad: cargo.especialidad,
            unidad_id: plantilla.unidad_id,
            unidad: unidad.nombre,
            cantidad_minima: plantilla.cantidad_minima,
        }).from(plantilla)
            .leftJoin(cargo, eq(plantilla.cargo_id, cargo.id))
            .leftJoin(unidad, eq(plantilla.unidad_id, unidad.id));
        const counts = await db.select({
            cargo_id: empleo.cargo_id,
            unidad_id: empleo.unidad_id,
            count: sql`COUNT(*)`.as('count'),
        }).from(empleo).groupBy(empleo.cargo_id, empleo.unidad_id);
        const countMap = new Map(counts.map(c => [`${c.cargo_id}-${c.unidad_id}`, c.count]));
        return rows.map(r => ({
            ...r,
            actual: countMap.get(`${r.cargo_id}-${r.unidad_id}`) || 0,
        }));
    },

    createPlantilla: async function createPlantilla({ input, caller }) {
        /**
         * Define staffing requirement: how many of a cargo are needed in a unit.
         * Input: cargo_id (string), unidad_id (string), cantidad_minima (number).
         * Output: the created plantilla row.
         */
        requireAuth(caller);
        if (!input.cargo_id) throw new Error('cargo_id is required');
        if (!input.unidad_id) throw new Error('unidad_id is required');
        if (!input.cantidad_minima) throw new Error('cantidad_minima is required');
        const [row] = await db.insert(plantilla).values(input).returning();
        return row;
    },

    updatePlantilla: crudUpdate(plantilla),

    // ─── Solicitudes ─────────────────────────────────────────────────────────
    solicitarPersonal: async function solicitarPersonal({ input, caller }) {
        /**
         * Request new positions (solicitud de personal). Only Francesco (200051), Lucas (100649), or Talento Humano staff can use this. Validates against plantilla — the request must fit within cantidad_maxima.
         * Input: cantidad (number), cargo_id (string), unidad_id (string).
         * Output: the created solicitud row. Throws if no plantilla exists or if cantidad exceeds available capacity.
         */
        requireAuth(caller);
        const allowed = [LUCAS_ID, FRANCESCO_ID];
        if (!allowed.includes(caller.codigo)) {
            const [emp] = await db.select().from(empleo)
                .where(and(eq(empleo.persona_id, caller.codigo), eq(empleo.unidad_id, TALENTO_HUMANO_ID)));
            if (!emp) throw new Error('unauthorized — solo Francesco, Lucas o Talento Humano');
        }
        if (!input.cantidad) throw new Error('cantidad is required');
        if (!input.cargo_id) throw new Error('cargo_id is required');
        if (!input.unidad_id) throw new Error('unidad_id is required');
        const [plan] = await db.select().from(plantilla)
            .where(and(eq(plantilla.cargo_id, input.cargo_id), eq(plantilla.unidad_id, input.unidad_id)));
        if (!plan) throw new Error('no existe plantilla para este cargo/unidad');
        const [{ count: actual }] = await db.select({ count: sql`COUNT(*)` }).from(empleo)
            .where(and(eq(empleo.cargo_id, input.cargo_id), eq(empleo.unidad_id, input.unidad_id)));
        const available = (plan.cantidad_maxima ?? Infinity) - actual;
        if (input.cantidad > available) throw new Error(`sin capacidad — actual: ${actual}, max: ${plan.cantidad_maxima}, disponible: ${available}`);
        const [row] = await db.insert(solicitud).values({
            tipo: 'solicitud_de_personal',
            caller_id: caller.codigo,
            data: JSON.stringify({
                cantidad: input.cantidad,
                cargo_id: input.cargo_id,
                unidad_id: input.unidad_id,
            }),
        }).returning();
        return row;
    },

    listSolicitudes: crudList(solicitud),

    aprobarSolicitud: async function aprobarSolicitud({ input, caller }) {
        /**
         * Approve or reject a solicitud. Only Francesco (200051) or Lucas (100649) can use this.
         * Input: id (string), aprobada (number, 1=aprobada 0=desaprobada).
         * Output: the updated solicitud row.
         */
        requireAuth(caller);
        if (![LUCAS_ID, FRANCESCO_ID].includes(caller.codigo)) throw new Error('unauthorized — solo Francesco o Lucas');
        requireId(input);
        if (input.aprobada == null) throw new Error('aprobada is required (1 or 0)');
        const [row] = await db.update(solicitud).set({
            aprobada: input.aprobada,
            updated_at: new Date().toISOString(),
        }).where(eq(solicitud.id, input.id)).returning();
        if (!row) throw new Error('solicitud not found');
        return row;
    },

    // ─── Hiring Process ──────────────────────────────────────────────────────
    ...hiring,

    // ─── Vacaciones y Permisos ────────────────────────────────────────────────
    solicitarVacaciones: async function solicitarVacaciones({ input, caller }) {
        /**
         * Request vacation. Creates a solicitud of tipo 'vacaciones' after validating sufficient balance.
         * Input: fecha_inicio (string, required — YYYY-MM-DD), fecha_fin (string, required — YYYY-MM-DD), dias (number, required — working days requested), motivo (string, optional).
         * Output: the created solicitud row. Throws if insufficient balance.
         */
        requireAuth(caller);
        if (!input.fecha_inicio || !input.fecha_fin || !input.dias) throw new Error('fecha_inicio, fecha_fin, and dias are required');
        const periodo = parseInt(input.fecha_inicio.slice(0, 4));
        let [saldo] = await db.select().from(saldo_vacaciones)
            .where(and(eq(saldo_vacaciones.persona_id, caller.codigo), eq(saldo_vacaciones.periodo, periodo)));
        if (!saldo) {
            [saldo] = await db.insert(saldo_vacaciones).values({ persona_id: caller.codigo, periodo }).returning();
        }
        const disponible = saldo.dias_acumulados - saldo.dias_usados - saldo.dias_reservados;
        if (input.dias > disponible) throw new Error(`saldo insuficiente — disponible: ${disponible}, solicitado: ${input.dias}`);
        await db.update(saldo_vacaciones).set({
            dias_reservados: saldo.dias_reservados + input.dias,
            updated_at: new Date().toISOString(),
        }).where(eq(saldo_vacaciones.id, saldo.id));
        const [row] = await db.insert(solicitud).values({
            tipo: 'vacaciones',
            caller_id: caller.codigo,
            data: JSON.stringify({
                fecha_inicio: input.fecha_inicio,
                fecha_fin: input.fecha_fin,
                dias: input.dias,
                motivo: input.motivo || '',
                periodo,
            }),
        }).returning();
        return row;
    },

    aprobarVacaciones: async function aprobarVacaciones({ input, caller }) {
        /**
         * Approve or reject a vacation request. Only Francesco or Lucas.
         * If approved, converts reserved days to used. If rejected, releases reserved days.
         * Input: id (string, required — solicitud id), aprobada (number, 1=approved 0=rejected).
         * Output: the updated solicitud row.
         */
        requireAuth(caller);
        if (![LUCAS_ID, FRANCESCO_ID].includes(caller.codigo)) throw new Error('unauthorized — solo Francesco o Lucas');
        requireId(input);
        if (input.aprobada == null) throw new Error('aprobada is required (1 or 0)');
        const [sol] = await db.select().from(solicitud).where(eq(solicitud.id, input.id));
        if (!sol) throw new Error('solicitud not found');
        if (sol.tipo !== 'vacaciones') throw new Error('solicitud is not a vacation request');
        if (sol.aprobada != null) throw new Error('solicitud already decided');
        const data = JSON.parse(sol.data);
        const [saldo] = await db.select().from(saldo_vacaciones)
            .where(and(eq(saldo_vacaciones.persona_id, sol.caller_id), eq(saldo_vacaciones.periodo, data.periodo)));
        if (!saldo) throw new Error('saldo not found');
        if (input.aprobada === 1) {
            await db.update(saldo_vacaciones).set({
                dias_usados: saldo.dias_usados + data.dias,
                dias_reservados: saldo.dias_reservados - data.dias,
                updated_at: new Date().toISOString(),
            }).where(eq(saldo_vacaciones.id, saldo.id));
        } else {
            await db.update(saldo_vacaciones).set({
                dias_reservados: saldo.dias_reservados - data.dias,
                updated_at: new Date().toISOString(),
            }).where(eq(saldo_vacaciones.id, saldo.id));
        }
        const [row] = await db.update(solicitud).set({
            aprobada: input.aprobada,
            estado: input.aprobada === 1 ? 'aprobada' : 'rechazada',
            updated_at: new Date().toISOString(),
        }).where(eq(solicitud.id, input.id)).returning();
        return row;
    },

    cancelarVacaciones: async function cancelarVacaciones({ input, caller }) {
        /**
         * Cancel a pending vacation request. Only the original requester can cancel. Releases reserved days.
         * Input: id (string, required — solicitud id).
         * Output: the updated solicitud row. Throws if already approved or cancelled.
         */
        requireAuth(caller);
        requireId(input);
        const [sol] = await db.select().from(solicitud).where(eq(solicitud.id, input.id));
        if (!sol) throw new Error('solicitud not found');
        if (sol.caller_id !== caller.codigo) throw new Error('solo el solicitante puede cancelar');
        if (sol.estado !== 'pendiente') throw new Error('solo se puede cancelar una solicitud pendiente');
        const data = JSON.parse(sol.data);
        const [saldo] = await db.select().from(saldo_vacaciones)
            .where(and(eq(saldo_vacaciones.persona_id, sol.caller_id), eq(saldo_vacaciones.periodo, data.periodo)));
        if (saldo) {
            await db.update(saldo_vacaciones).set({
                dias_reservados: saldo.dias_reservados - data.dias,
                updated_at: new Date().toISOString(),
            }).where(eq(saldo_vacaciones.id, saldo.id));
        }
        const [row] = await db.update(solicitud).set({
            estado: 'cancelada',
            updated_at: new Date().toISOString(),
        }).where(eq(solicitud.id, input.id)).returning();
        return row;
    },

    getSaldoVacaciones: async function getSaldoVacaciones({ input, caller }) {
        /**
         * Get vacation balance for a person. Auto-creates a default balance if none exists for the requested period.
         * Input: persona_id (number, required), periodo (number, optional — defaults to current year).
         * Output: saldo_vacaciones row with computed 'disponible' field.
         */
        requireAuth(caller);
        requireId(input, 'persona_id');
        const periodo = input.periodo || new Date().getFullYear();
        let [saldo] = await db.select().from(saldo_vacaciones)
            .where(and(eq(saldo_vacaciones.persona_id, input.persona_id), eq(saldo_vacaciones.periodo, periodo)));
        if (!saldo) {
            [saldo] = await db.insert(saldo_vacaciones).values({ persona_id: input.persona_id, periodo }).returning();
        }
        return { ...saldo, disponible: saldo.dias_acumulados - saldo.dias_usados - saldo.dias_reservados };
    },

    listSaldosVacaciones: async function listSaldosVacaciones({ input, caller }) {
        /**
         * List vacation balances.
         * Input: persona_id (number, optional), periodo (number, optional — year).
         * Output: array of saldo_vacaciones rows, each with computed 'disponible' field.
         */
        requireAuth(caller);
        const conditions = [];
        if (input.persona_id) conditions.push(eq(saldo_vacaciones.persona_id, input.persona_id));
        if (input.periodo) conditions.push(eq(saldo_vacaciones.periodo, input.periodo));
        let q = db.select().from(saldo_vacaciones);
        if (conditions.length) q = q.where(and(...conditions));
        const rows = await q;
        return rows.map(r => ({ ...r, disponible: r.dias_acumulados - r.dias_usados - r.dias_reservados }));
    },

    listVacaciones: async function listVacaciones({ input, caller }) {
        /**
         * List vacation and permission requests.
         * Input: persona_id (number, optional — filter by person).
         * Output: array of solicitud rows filtered by vacation/permission tipos.
         */
        requireAuth(caller);
        const tipoFilter = or(eq(solicitud.tipo, 'vacaciones'), eq(solicitud.tipo, 'permiso'));
        if (input.persona_id) {
            return db.select().from(solicitud).where(and(tipoFilter, eq(solicitud.caller_id, input.persona_id)));
        }
        return db.select().from(solicitud).where(tipoFilter);
    },

    solicitarPermiso: async function solicitarPermiso({ input, caller }) {
        /**
         * Request a permission (non-vacation, no balance impact).
         * Input: fecha (string, required), motivo (string, required), tipo_permiso (string — medico/personal/familiar/otro), horas (number, optional).
         * Output: the created solicitud row.
         */
        requireAuth(caller);
        if (!input.fecha || !input.motivo) throw new Error('fecha and motivo are required');
        const [row] = await db.insert(solicitud).values({
            tipo: 'permiso',
            caller_id: caller.codigo,
            data: JSON.stringify({
                fecha: input.fecha,
                motivo: input.motivo,
                tipo_permiso: input.tipo_permiso || 'otro',
                horas: input.horas || null,
            }),
        }).returning();
        return row;
    },

    listDocumentos: async function listDocumentos({ input, caller }) {
        /**
         * List documentos. Always returns rows ordered by created_at DESC (most recent first).
         * Input: tipo (string, optional — filter by document type), desde (string, optional — created_at >= date), hasta (string, optional — created_at <= date), limit (number, optional — defaults to 50).
         * Output: array of documento rows {id, tipo, caller_id, data, created_at, updated_at}.
         */
        requireAuth(caller);
        const conditions = [];
        if (input.tipo) conditions.push(eq(documento.tipo, input.tipo));
        if (input.desde) conditions.push(sql`${documento.created_at} >= ${input.desde}`);
        if (input.hasta) conditions.push(sql`${documento.created_at} <= ${input.hasta}`);
        let q = db.select().from(documento);
        if (conditions.length) q = q.where(and(...conditions));
        return q.orderBy(sql`${documento.created_at} DESC`).limit(input.limit || 50);
    },

    listAliases: async function listAliases({ caller }) {
        /**
         * List all unit aliases.
         * Input: none.
         * Output: array of alias rows {unidad_id, alias}.
         */
        requireAuth(caller);
        return db.select().from(alias);
    },

    createDocumento: async function createDocumento({ input, caller }) {
        /**
         * Create a documento record. All fields besides tipo go into the data JSON column.
         * For digitally signed documents, data contains the filled fields + firma (path to signature PNG) — no PDF copy needed since it can be regenerated from the template + data.
         * For physical uploads, include upload (string — path to uploaded file) in the data.
         * Input: tipo (string, required), and any additional fields (nombres, apellidos, cedula, ciudad, firma, upload, cargo_id, unidad_id, etc).
         * Output: the created documento row.
         */
        requireAuth(caller);
        if (!input.tipo) throw new Error('tipo is required');
        const { tipo, ...data } = input;
        const storageDir = new URL('../storage/', import.meta.url);
        mkdirSync(storageDir, { recursive: true });
        const imageKeys = ['firma', 'croquis'];
        for (const key of Object.keys(data)) {
            if ((key.startsWith('firma') || imageKeys.includes(key)) && data[key] && data[key].startsWith('data:')) {
                const base64 = data[key].replace(/^data:image\/\w+;base64,/, '');
                const filename = `${key}_${caller.codigo}_${Date.now()}.png`;
                writeFileSync(new URL(filename, storageDir), Buffer.from(base64, 'base64'));
                data[key] = `/storage/${filename}`;
            }
        }
        const cleanup = data._cleanup;
        delete data._cleanup;
        const [row] = await db.insert(documento).values({
            tipo,
            caller_id: caller.codigo,
            data: JSON.stringify(data),
        }).returning();
        if (cleanup?.length) {
            const downloadsDir = new URL('../downloads/', import.meta.url);
            for (const path of cleanup) {
                try { unlinkSync(new URL(path.replace('/downloads/', ''), downloadsDir)); } catch {}
            }
        }
        return row;
    },

    updateDocumento: async function updateDocumento({ input, caller }) {
        /**
         * Update a documento's data (merges into existing JSON data).
         * Input: id (string, required), plus any keys to merge into data (e.g. firma, upload, cargo_id, unidad_id).
         * Output: the updated documento row.
         */
        requireAuth(caller);
        requireId(input);
        return mergeJsonUpdate(documento, input.id, input);
    },

    // ─── Evento ──────────────────────────────────────────────────────────────
    listEventos: async function listEventos({ input, caller }) {
        /**
         * List calendar events. All filters optional. Returns ordered by fecha DESC.
         * Input: persona_id (number, optional), desde (string, optional — fecha start), hasta (string, optional — fecha end).
         * Output: array of evento rows {id, persona_id, fecha, data, created_at}.
         */
        requireAuth(caller);
        const conditions = [];
        if (input.persona_id) conditions.push(eq(evento.persona_id, input.persona_id));
        if (input.desde) conditions.push(sql`${evento.fecha} >= ${input.desde}`);
        if (input.hasta) conditions.push(sql`${evento.fecha} <= ${input.hasta}`);
        let q = db.select().from(evento);
        if (conditions.length) q = q.where(and(...conditions));
        return q.orderBy(sql`${evento.fecha} DESC`);
    },

    createEvento: async function createEvento({ input, caller }) {
        /**
         * Create a calendar event for a person.
         * Input: persona_id (number, required), fecha (string, required — YYYY-MM-DD), and any additional fields (titulo, descripcion, tipo, etc) go into data JSON.
         * Output: the created evento row.
         */
        requireAuth(caller);
        requireId(input, 'persona_id');
        if (!input.fecha) throw new Error('fecha is required');
        const { persona_id, fecha, ...data } = input;
        const [row] = await db.insert(evento).values({
            persona_id, fecha, data: JSON.stringify(data),
        }).returning();
        return row;
    },

    updateEvento: async function updateEvento({ input, caller }) {
        /**
         * Update a calendar event (merges into existing data JSON).
         * Input: id (string, required), fecha (string, optional), plus any fields to merge into data.
         * Output: the updated evento row.
         */
        requireAuth(caller);
        requireId(input);
        return mergeJsonUpdate(evento, input.id, input, { dateField: 'fecha' });
    },

    deleteEvento: async function deleteEvento({ input, caller }) {
        /**
         * Delete a calendar event.
         * Input: id (string, required).
         * Output: {deleted: true}.
         */
        requireAuth(caller);
        requireId(input);
        await db.delete(evento).where(eq(evento.id, input.id));
        return { deleted: true };
    },

    // ─── Asistencia ──────────────────────────────────────────────────────────
    registrarEntrada: async function registrarEntrada({ input, caller }) {
        /**
         * Clock in a person. Fails if they already have an open entry.
         * Input: persona_id (number).
         * Output: the created asistencia row {id, persona_id, entrada}.
         */
        requireAuth(caller);
        requireId(input, 'persona_id');
        const [open] = await db.select().from(asistencia)
            .where(and(eq(asistencia.persona_id, input.persona_id), isNull(asistencia.salida)));
        if (open) throw new Error('ya tiene una entrada abierta');
        const [row] = await db.insert(asistencia).values({
            id: input.id,
            persona_id: input.persona_id,
            entrada: new Date().toISOString(),
        }).returning();
        return row;
    },

    registrarSalida: async function registrarSalida({ input, caller }) {
        /**
         * Clock out a person. Fails if they have no open entry.
         * Input: persona_id (number).
         * Output: the updated asistencia row {id, persona_id, entrada, salida}.
         */
        requireAuth(caller);
        requireId(input, 'persona_id');
        const [open] = await db.select().from(asistencia)
            .where(and(eq(asistencia.persona_id, input.persona_id), isNull(asistencia.salida)));
        if (!open) throw new Error('no tiene una entrada abierta');
        const [row] = await db.update(asistencia)
            .set({ salida: new Date().toISOString() })
            .where(eq(asistencia.id, open.id))
            .returning();
        return row;
    },

    registrarEntradaMasiva: async function registrarEntradaMasiva({ input, caller }) {
        /**
         * Clock in multiple people at once. Skips anyone who already has an open entry.
         * Input: persona_ids (array of numbers).
         * Output: {registrados: asistencia[], omitidos: number[]} — who was clocked in vs skipped.
         */
        requireAuth(caller);
        if (!input.persona_ids?.length) throw new Error('persona_ids es requerido');
        const now = new Date().toISOString();
        const abiertos = await db.select({ persona_id: asistencia.persona_id }).from(asistencia)
            .where(and(inArray(asistencia.persona_id, input.persona_ids), isNull(asistencia.salida)));
        const abiertosSet = new Set(abiertos.map(r => r.persona_id));
        const insertar = input.persona_ids
            .filter(id => !abiertosSet.has(id))
            .map(id => ({ id: `${id}-${now}`, persona_id: id, entrada: now }));
        if (!insertar.length) return { registrados: [], omitidos: input.persona_ids };
        const rows = await db.insert(asistencia).values(insertar).returning();
        return { registrados: rows, omitidos: [...abiertosSet] };
    },

    registrarSalidaMasiva: async function registrarSalidaMasiva({ input, caller }) {
        /**
         * Clock out multiple people at once. Skips anyone without an open entry.
         * Input: persona_ids (array of numbers).
         * Output: {registrados: asistencia[], omitidos: number[]} — who was clocked out vs skipped.
         */
        requireAuth(caller);
        if (!input.persona_ids?.length) throw new Error('persona_ids es requerido');
        const now = new Date().toISOString();
        const abiertos = await db.select().from(asistencia)
            .where(and(inArray(asistencia.persona_id, input.persona_ids), isNull(asistencia.salida)));
        if (!abiertos.length) return { registrados: [], omitidos: input.persona_ids };
        const abiertosIds = abiertos.map(r => r.id);
        const rows = await db.update(asistencia)
            .set({ salida: now })
            .where(inArray(asistencia.id, abiertosIds))
            .returning();
        const registradosSet = new Set(abiertos.map(r => r.persona_id));
        return { registrados: rows, omitidos: input.persona_ids.filter(id => !registradosSet.has(id)) };
    },

    listAsistencia: async function listAsistencia({ input, caller }) {
        /**
         * List attendance records. All filters optional. Returns ordered by entrada DESC.
         * Input: persona_id (number, optional).
         * Output: array of asistencia rows {id, persona_id, entrada, salida}.
         */
        requireAuth(caller);
        let q = db.select().from(asistencia);
        if (input.persona_id) q = q.where(eq(asistencia.persona_id, input.persona_id));
        return q.orderBy(sql`${asistencia.entrada} DESC`);
    },

    // ─── Auditoria ──────────────────────────────────────────────────────────
    listAuditoria: async function listAuditoria({ input, caller }) {
        /**
         * List audit log entries (admin only).
         * Input: persona_id (number, optional), operacion (string, optional), desde (string, optional), hasta (string, optional), limit (number, optional — default 100).
         * Output: array of registro_auditoria rows.
         */
        requireAdmin(caller);
        const conditions = [];
        if (input.persona_id) conditions.push(eq(registro_auditoria.persona_id, input.persona_id));
        if (input.operacion) conditions.push(eq(registro_auditoria.operacion, input.operacion));
        if (input.desde) conditions.push(sql`${registro_auditoria.created_at} >= ${input.desde}`);
        if (input.hasta) conditions.push(sql`${registro_auditoria.created_at} <= ${input.hasta}`);
        let q = db.select().from(registro_auditoria);
        if (conditions.length) q = q.where(and(...conditions));
        return q.orderBy(sql`${registro_auditoria.created_at} DESC`).limit(input.limit || 100);
    },

    // ─── Contratos ──────────────────────────────────────────────────────────
    createContrato: async function createContrato({ input, caller }) {
        /**
         * Create a contract for an employment record.
         * Input: empleo_id (string, required), tipo (string, required), fecha_inicio (string, required), sueldo (string, required), fecha_fin (string, optional), and any extra fields go into data JSON.
         * Output: the created contrato row.
         */
        requireAuth(caller);
        const { empleo_id, tipo, fecha_inicio, fecha_fin, sueldo, ...data } = input;
        if (!empleo_id || !tipo || !fecha_inicio || !sueldo) throw new Error('empleo_id, tipo, fecha_inicio, and sueldo are required');
        const [emp] = await db.select().from(empleo).where(eq(empleo.id, empleo_id));
        if (!emp) throw new Error('empleo not found');
        const [row] = await db.insert(contrato).values({
            empleo_id, tipo, fecha_inicio, fecha_fin, sueldo,
            data: JSON.stringify(data),
        }).returning();
        return row;
    },

    renovarContrato: async function renovarContrato({ input, caller }) {
        /**
         * Renew a contract: closes the current version and creates a new one.
         * Input: id (string, required — current contrato id), fecha_inicio (string, required), sueldo (string, required), fecha_fin (string, optional), tipo (string, optional — defaults to current), and any extra fields for data JSON.
         * Output: the new contrato row.
         */
        requireAuth(caller);
        requireId(input);
        const [current] = await db.select().from(contrato).where(eq(contrato.id, input.id));
        if (!current) throw new Error('contrato not found');
        if (current.estado !== 'activo') throw new Error('solo se puede renovar un contrato activo');
        await db.update(contrato).set({ estado: 'renovado', updated_at: new Date().toISOString() }).where(eq(contrato.id, input.id));
        const { id: _, fecha_inicio, fecha_fin, sueldo, tipo, ...data } = input;
        const [row] = await db.insert(contrato).values({
            empleo_id: current.empleo_id,
            tipo: tipo || current.tipo,
            fecha_inicio, fecha_fin, sueldo,
            data: JSON.stringify(data),
            version: current.version + 1,
        }).returning();
        return row;
    },

    terminarContrato: async function terminarContrato({ input, caller }) {
        /**
         * Terminate a contract.
         * Input: id (string, required), fecha_fin (string, optional — defaults to today).
         * Output: the updated contrato row.
         */
        requireAuth(caller);
        requireId(input);
        const [row] = await db.update(contrato).set({
            estado: 'terminado',
            fecha_fin: input.fecha_fin || new Date().toISOString().split('T')[0],
            updated_at: new Date().toISOString(),
        }).where(eq(contrato.id, input.id)).returning();
        if (!row) throw new Error('contrato not found');
        return row;
    },

    listContratos: async function listContratos({ input, caller }) {
        /**
         * List contracts.
         * Input: empleo_id (string, optional — filter by employment).
         * Output: array of contrato rows.
         */
        requireAuth(caller);
        if (input.empleo_id) return db.select().from(contrato).where(eq(contrato.empleo_id, input.empleo_id));
        return db.select().from(contrato);
    },

    getContrato: async function getContrato({ input, caller }) {
        /**
         * Get a single contract.
         * Input: id (string, required).
         * Output: contrato row.
         */
        requireAuth(caller);
        requireId(input);
        const [row] = await db.select().from(contrato).where(eq(contrato.id, input.id));
        if (!row) throw new Error('contrato not found');
        return row;
    },

    // ─── Carnets ────────────────────────────────────────────────────────────
    emitirCarnet: async function emitirCarnet({ input, caller }) {
        /**
         * Issue a badge to a person.
         * Input: persona_id (number, required), numero (string, required).
         * Output: the created carnet row.
         */
        requireAuth(caller);
        requireId(input, 'persona_id');
        if (!input.numero) throw new Error('numero is required');
        const [row] = await db.insert(carnet).values({
            persona_id: input.persona_id,
            numero: input.numero,
            fecha_emision: new Date().toISOString().split('T')[0],
        }).returning();
        return row;
    },

    reportarCarnetPerdido: async function reportarCarnetPerdido({ input, caller }) {
        /**
         * Report a badge as lost.
         * Input: id (string, required).
         * Output: the updated carnet row.
         */
        requireAuth(caller);
        requireId(input);
        const [row] = await db.update(carnet).set({ estado: 'perdido', updated_at: new Date().toISOString() })
            .where(eq(carnet.id, input.id)).returning();
        if (!row) throw new Error('carnet not found');
        return row;
    },

    reemplazarCarnet: async function reemplazarCarnet({ input, caller }) {
        /**
         * Replace a lost/damaged badge. Marks the old one as 'reemplazado' and creates a new one.
         * Input: id (string, required — old carnet id), numero (string, required — new badge number).
         * Output: the new carnet row.
         */
        requireAuth(caller);
        requireId(input);
        if (!input.numero) throw new Error('numero is required');
        const [old] = await db.select().from(carnet).where(eq(carnet.id, input.id));
        if (!old) throw new Error('carnet not found');
        await db.update(carnet).set({ estado: 'reemplazado', updated_at: new Date().toISOString() }).where(eq(carnet.id, input.id));
        const [row] = await db.insert(carnet).values({
            persona_id: old.persona_id,
            numero: input.numero,
            fecha_emision: new Date().toISOString().split('T')[0],
        }).returning();
        return row;
    },

    devolverCarnet: async function devolverCarnet({ input, caller }) {
        /**
         * Return a badge.
         * Input: id (string, required).
         * Output: the updated carnet row.
         */
        requireAuth(caller);
        requireId(input);
        const [row] = await db.update(carnet).set({
            estado: 'devuelto',
            fecha_devolucion: new Date().toISOString().split('T')[0],
            updated_at: new Date().toISOString(),
        }).where(eq(carnet.id, input.id)).returning();
        if (!row) throw new Error('carnet not found');
        return row;
    },

    listCarnets: async function listCarnets({ input, caller }) {
        /**
         * List badges.
         * Input: persona_id (number, optional — filter by person).
         * Output: array of carnet rows.
         */
        requireAuth(caller);
        if (input.persona_id) return db.select().from(carnet).where(eq(carnet.persona_id, input.persona_id));
        return db.select().from(carnet);
    },

    // ─── Activos ────────────────────────────────────────────────────────────
    asignarActivo: async function asignarActivo({ input, caller }) {
        /**
         * Assign an asset to a person.
         * Input: persona_id (number, required), tipo (string, required — uniforme/EPP/herramienta), descripcion (string, required), talla (string, optional), cantidad (number, optional — defaults to 1).
         * Output: the created asignacion_activo row.
         */
        requireAuth(caller);
        requireId(input, 'persona_id');
        if (!input.tipo || !input.descripcion) throw new Error('tipo and descripcion are required');
        const [row] = await db.insert(asignacion_activo).values({
            persona_id: input.persona_id,
            tipo: input.tipo,
            descripcion: input.descripcion,
            talla: input.talla || null,
            cantidad: input.cantidad || 1,
            fecha_entrega: new Date().toISOString().split('T')[0],
        }).returning();
        return row;
    },

    devolverActivo: async function devolverActivo({ input, caller }) {
        /**
         * Return an assigned asset.
         * Input: id (string, required).
         * Output: the updated asignacion_activo row.
         */
        requireAuth(caller);
        requireId(input);
        const [row] = await db.update(asignacion_activo).set({
            estado: 'devuelto',
            fecha_devolucion: new Date().toISOString().split('T')[0],
            updated_at: new Date().toISOString(),
        }).where(eq(asignacion_activo.id, input.id)).returning();
        if (!row) throw new Error('activo not found');
        return row;
    },

    listActivos: async function listActivos({ input, caller }) {
        /**
         * List asset assignments.
         * Input: persona_id (number, optional — filter by person).
         * Output: array of asignacion_activo rows.
         */
        requireAuth(caller);
        if (input.persona_id) return db.select().from(asignacion_activo).where(eq(asignacion_activo.persona_id, input.persona_id));
        return db.select().from(asignacion_activo);
    },

    // ─── Capacitacion ───────────────────────────────────────────────────────
    registrarCapacitacion: async function registrarCapacitacion({ input, caller }) {
        /**
         * Register a training/compliance record.
         * Input: persona_id (number, required), tipo (string, required — induccion/seguridad/BASC/anticorrupcion/reciclaje), nombre (string, required), fecha (string, required), fecha_vencimiento (string, optional), and any extra fields go into data JSON.
         * Output: the created capacitacion row.
         */
        requireAuth(caller);
        requireId(input, 'persona_id');
        if (!input.tipo || !input.nombre || !input.fecha) throw new Error('tipo, nombre, and fecha are required');
        const { persona_id, tipo, nombre, fecha, fecha_vencimiento, ...data } = input;
        const [row] = await db.insert(capacitacion).values({
            persona_id, tipo, nombre, fecha, fecha_vencimiento,
            data: JSON.stringify(data),
        }).returning();
        return row;
    },

    completarCapacitacion: async function completarCapacitacion({ input, caller }) {
        /**
         * Mark a training as completed.
         * Input: id (string, required), and any extra fields to merge into data JSON (e.g. calificacion, observaciones).
         * Output: the updated capacitacion row.
         */
        requireAuth(caller);
        requireId(input);
        const [existing] = await db.select().from(capacitacion).where(eq(capacitacion.id, input.id));
        if (!existing) throw new Error('capacitacion not found');
        const { id: _, ...fields } = input;
        const merged = { ...JSON.parse(existing.data), ...fields };
        const [row] = await db.update(capacitacion).set({
            estado: 'completado',
            data: JSON.stringify(merged),
            updated_at: new Date().toISOString(),
        }).where(eq(capacitacion.id, input.id)).returning();
        return row;
    },

    listCapacitaciones: async function listCapacitaciones({ input, caller }) {
        /**
         * List training records.
         * Input: persona_id (number, optional), tipo (string, optional), estado (string, optional).
         * Output: array of capacitacion rows.
         */
        requireAuth(caller);
        const conditions = [];
        if (input.persona_id) conditions.push(eq(capacitacion.persona_id, input.persona_id));
        if (input.tipo) conditions.push(eq(capacitacion.tipo, input.tipo));
        if (input.estado) conditions.push(eq(capacitacion.estado, input.estado));
        let q = db.select().from(capacitacion);
        if (conditions.length) q = q.where(and(...conditions));
        return q;
    },

    getCapacitacionesPendientes: async function getCapacitacionesPendientes({ input, caller }) {
        /**
         * Get overdue and upcoming training. Finds records with fecha_vencimiento past (overdue) or within N days (upcoming).
         * Input: persona_id (number, optional), dias (number, optional — lookahead days, defaults to 30).
         * Output: {vencidas: capacitacion[], proximas: capacitacion[]}.
         */
        requireAuth(caller);
        const today = new Date().toISOString().split('T')[0];
        const lookahead = new Date();
        lookahead.setDate(lookahead.getDate() + (input.dias || 30));
        const limite = lookahead.toISOString().split('T')[0];

        const conditions = [sql`${capacitacion.fecha_vencimiento} IS NOT NULL`];
        if (input.persona_id) conditions.push(eq(capacitacion.persona_id, input.persona_id));

        const rows = await db.select().from(capacitacion)
            .where(and(...conditions, sql`${capacitacion.estado} != 'completado'`));

        const vencidas = [];
        const proximas = [];
        for (const r of rows) {
            if (r.fecha_vencimiento < today) {
                if (r.estado !== 'vencido') {
                    await db.update(capacitacion).set({ estado: 'vencido', updated_at: new Date().toISOString() })
                        .where(eq(capacitacion.id, r.id));
                    r.estado = 'vencido';
                }
                vencidas.push(r);
            } else if (r.fecha_vencimiento <= limite) {
                proximas.push(r);
            }
        }
        return { vencidas, proximas };
    },

    // ─── Casos Disciplinarios ───────────────────────────────────────────────
    abrirCasoDisciplinario: async function abrirCasoDisciplinario({ input, caller }) {
        /**
         * Open a disciplinary case.
         * Input: persona_id (number, required), tipo (string, required — amonestacion/llamado_atencion/suspension/desahucio), descripcion (string, required), fecha (string, optional — defaults to today), and any extra fields go into data JSON.
         * Output: the created caso_disciplinario row.
         */
        requireAuth(caller);
        requireId(input, 'persona_id');
        if (!input.tipo || !input.descripcion) throw new Error('tipo and descripcion are required');
        const { persona_id, tipo, descripcion, fecha, ...data } = input;
        const [row] = await db.insert(caso_disciplinario).values({
            persona_id, tipo, descripcion,
            fecha: fecha || new Date().toISOString().split('T')[0],
            data: JSON.stringify(data),
        }).returning();
        return row;
    },

    registrarAccion: async function registrarAccion({ input, caller }) {
        /**
         * Record an action on a disciplinary case. Appends to the case's action history.
         * Input: id (string, required — caso id), accion (string, required), fecha (string, optional — defaults to today), and any extra fields.
         * Output: the updated caso_disciplinario row.
         */
        requireAuth(caller);
        requireId(input);
        if (!input.accion) throw new Error('accion is required');
        const [existing] = await db.select().from(caso_disciplinario).where(eq(caso_disciplinario.id, input.id));
        if (!existing) throw new Error('caso not found');
        if (existing.estado === 'cerrado') throw new Error('caso already closed');
        const data = JSON.parse(existing.data);
        if (!data.acciones) data.acciones = [];
        const { id: _, accion, fecha, ...extras } = input;
        data.acciones.push({ accion, fecha: fecha || new Date().toISOString().split('T')[0], registrado_por: caller.codigo, ...extras });
        const [row] = await db.update(caso_disciplinario).set({
            data: JSON.stringify(data),
            updated_at: new Date().toISOString(),
        }).where(eq(caso_disciplinario.id, input.id)).returning();
        return row;
    },

    cerrarCaso: async function cerrarCaso({ input, caller }) {
        /**
         * Close a disciplinary case.
         * Input: id (string, required), resolucion (string, optional).
         * Output: the updated caso_disciplinario row.
         */
        requireAuth(caller);
        requireId(input);
        const [existing] = await db.select().from(caso_disciplinario).where(eq(caso_disciplinario.id, input.id));
        if (!existing) throw new Error('caso not found');
        const data = JSON.parse(existing.data);
        if (input.resolucion) data.resolucion = input.resolucion;
        const [row] = await db.update(caso_disciplinario).set({
            estado: 'cerrado',
            data: JSON.stringify(data),
            updated_at: new Date().toISOString(),
        }).where(eq(caso_disciplinario.id, input.id)).returning();
        return row;
    },

    listCasosDisciplinarios: async function listCasosDisciplinarios({ input, caller }) {
        /**
         * List disciplinary cases.
         * Input: persona_id (number, optional), estado (string, optional — abierto/cerrado), tipo (string, optional).
         * Output: array of caso_disciplinario rows.
         */
        requireAuth(caller);
        const conditions = [];
        if (input.persona_id) conditions.push(eq(caso_disciplinario.persona_id, input.persona_id));
        if (input.estado) conditions.push(eq(caso_disciplinario.estado, input.estado));
        if (input.tipo) conditions.push(eq(caso_disciplinario.tipo, input.tipo));
        let q = db.select().from(caso_disciplinario);
        if (conditions.length) q = q.where(and(...conditions));
        return q;
    },
};
