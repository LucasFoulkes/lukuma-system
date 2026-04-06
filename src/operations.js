// operations.js
import { eq, like, or, and, isNull, inArray, sql } from 'drizzle-orm';
import { persona, empleo, cargo, unidad, banco, asistencia, sqlite } from './database.js';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret';

function requireCaller(caller) {
    if (!caller) throw new Error('not authenticated');
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

export const operations = {

    // ─── Schema ─────────────────────────────────────────────────────────────
    async getSchema({ caller }) {
        requireCaller(caller);
        const tables = sqlite.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`
        ).all();
        return tables.map(t => ({
            table: t.name,
            columns: sqlite.prepare(`PRAGMA table_info('${t.name}')`).all(),
        }));
    },

    // ─── Auth ───────────────────────────────────────────────────────────────
    async login({ input, db }) {
        const { usuario, contrasena } = input;
        if (!usuario || !contrasena) throw new Error('usuario and contrasena are required');
        const [p] = await db.select().from(persona)
            .where(eq(persona.usuario, usuario));
        if (!p || p.contrasena !== contrasena) throw new Error('invalid credentials');
        const token = jwt.sign({ codigo: p.codigo, nombres: p.nombres, apellidos: p.apellidos }, SECRET);
        return { token };
    },

    // ─── Banco ───────────────────────────────────────────────────────────────
    async listBancos({ caller, db }) {
        requireCaller(caller);
        return db.select().from(banco);
    },
    async createBanco({ input, caller, db }) {
        requireCaller(caller);
        const [row] = await db.insert(banco).values(input).returning();
        return row;
    },
    async updateBanco({ input, caller, db }) {
        requireCaller(caller);
        const { id, ...data } = input;
        const [row] = await db.update(banco).set(data).where(eq(banco.id, id)).returning();
        return row;
    },
    // ─── Unidad ──────────────────────────────────────────────────────────────
    async listUnidades({ caller, db }) {
        requireCaller(caller);
        return db.select().from(unidad);
    },
    async createUnidad({ input, caller, db }) {
        requireCaller(caller);
        const [row] = await db.insert(unidad).values(input).returning();
        return row;
    },
    async updateUnidad({ input, caller, db }) {
        requireCaller(caller);
        const { id, ...data } = input;
        const [row] = await db.update(unidad).set(data).where(eq(unidad.id, id)).returning();
        return row;
    },
    // ─── Cargo ───────────────────────────────────────────────────────────────
    async listCargos({ caller, db }) {
        requireCaller(caller);
        return db.select().from(cargo);
    },
    async createCargo({ input, caller, db }) {
        requireCaller(caller);
        const [row] = await db.insert(cargo).values(input).returning();
        return row;
    },
    async updateCargo({ input, caller, db }) {
        requireCaller(caller);
        const { id, ...data } = input;
        const [row] = await db.update(cargo).set(data).where(eq(cargo.id, id)).returning();
        return row;
    },
    // ─── Persona ─────────────────────────────────────────────────────────────
    async listPersonas({ caller, db }) {
        requireCaller(caller);
        return db.select().from(persona);
    },
    async searchPersona({ input, caller, db }) {
        requireCaller(caller);
        if (!input.name) throw new Error('name is required');
        const term = `%${input.name.toUpperCase()}%`;
        return db.select().from(persona).where(
            or(
                like(sql`UPPER(${persona.nombres})`, term),
                like(sql`UPPER(${persona.apellidos})`, term)
            )
        );
    },
    async getPersona({ input, caller, db }) {
        requireCaller(caller);
        if (!input.id) throw new Error('id is required');
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
    async createPersona({ input, caller, db }) {
        requireCaller(caller);
        const [row] = await db.insert(persona).values(input).returning();
        return row;
    },
    async updatePersona({ input, caller, db }) {
        requireCaller(caller);
        const { codigo, ...data } = input;
        const [row] = await db.update(persona).set(data).where(eq(persona.codigo, codigo)).returning();
        return row;
    },
    // ─── Empleo ──────────────────────────────────────────────────────────────
    async listEmpleos({ caller, db }) {
        requireCaller(caller);
        return db.select().from(empleo);
    },
    async createEmpleo({ input, caller, db }) {
        requireCaller(caller);
        const [row] = await db.insert(empleo).values(input).returning();
        return row;
    },
    async updateEmpleo({ input, caller, db }) {
        requireCaller(caller);
        const { id, ...data } = input;
        const [row] = await db.update(empleo).set(data).where(eq(empleo.id, id)).returning();
        return row;
    },
    // ─── Asistencia ──────────────────────────────────────────────────────────
    async registrarEntrada({ input, caller, db }) {
        requireCaller(caller);
        if (!input.persona_id) throw new Error('persona_id is required');
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
    async registrarSalida({ input, caller, db }) {
        requireCaller(caller);
        if (!input.persona_id) throw new Error('persona_id is required');
        const [open] = await db.select().from(asistencia)
            .where(and(eq(asistencia.persona_id, input.persona_id), isNull(asistencia.salida)));
        if (!open) throw new Error('no tiene una entrada abierta');
        const [row] = await db.update(asistencia)
            .set({ salida: new Date().toISOString() })
            .where(eq(asistencia.id, open.id))
            .returning();
        return row;
    },
    async registrarEntradaMasiva({ input, caller, db }) {
        requireCaller(caller);
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
    async registrarSalidaMasiva({ input, caller, db }) {
        requireCaller(caller);
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
    async listAsistencia({ input, caller, db }) {
        requireCaller(caller);
        if (!input.persona_id) throw new Error('persona_id is required');
        return db.select().from(asistencia)
            .where(eq(asistencia.persona_id, input.persona_id));
    },
};
