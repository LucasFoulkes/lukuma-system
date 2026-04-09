import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

export const sqlite = new Database('system.db');
export const db = drizzle(sqlite);


// ─── Banco ───────────────────────────────────────────────────────────────────
export const banco = sqliteTable('banco', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull().unique(),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Unidad ──────────────────────────────────────────────────────────────────
export const unidad = sqliteTable('unidad', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull(),
  tipo: text('tipo').notNull(),
  parent_id: text('parent_id').references(() => unidad.id),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Cargo ───────────────────────────────────────────────────────────────────
export const cargo = sqliteTable('cargo', {
  id: text('id').primaryKey(),
  rol_base: text('rol_base'),
  especialidad: text('especialidad'),
  codigo_iess: text('codigo_iess'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Persona ─────────────────────────────────────────────────────────────────
export const persona = sqliteTable('persona', {
  codigo: integer('codigo').primaryKey(),
  cedula: integer('cedula').notNull().unique(),
  apellidos: text('apellidos').notNull(),
  nombres: text('nombres').notNull(),
  fecha_nacimiento: text('fecha_nacimiento'),
  lugar_nacimiento: text('lugar_nacimiento'),
  sexo: text('sexo'),
  estado_civil: text('estado_civil'),
  cargas_familiares: integer('cargas_familiares'),
  titulo: text('titulo'),
  profesion: text('profesion'),
  email: text('email'),
  movil: text('movil'),
  telefono: text('telefono'),
  lugar_residencia: text('lugar_residencia'),
  calle: text('calle'),
  referencia: text('referencia'),
  casa_numero: text('casa_numero'),
  usuario: text('usuario'),
  contrasena: text('contrasena'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Empleo ──────────────────────────────────────────────────────────────────
export const empleo = sqliteTable('empleo', {
  id: text('id').primaryKey(),
  persona_id: integer('persona_id').notNull().references(() => persona.codigo),
  cargo_id: text('cargo_id').notNull().references(() => cargo.id),
  unidad_id: text('unidad_id').notNull().references(() => unidad.id),
  banco_id: text('banco_id').references(() => banco.id),
  tipo_contrato: text('tipo_contrato').notNull(),
  fecha_inicio: text('fecha_inicio').notNull(),
  fecha_fin: text('fecha_fin'),
  numero_cuenta: text('numero_cuenta'),
  alterno: integer('alterno'),
  perfil_horario: text('perfil_horario'),
  estructura_costos: text('estructura_costos'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Alias ──────────────────────────────────────────────────────────────
export const alias = sqliteTable('alias', {
  unidad_id: text('unidad_id').primaryKey().references(() => unidad.id),
  alias: text('alias').notNull(),
});


// ─── Plantilla ──────────────────────────────────────────────────────────
export const plantilla = sqliteTable('plantilla', {
  id: text('id').primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10)),
  cargo_id: text('cargo_id').notNull().references(() => cargo.id),
  unidad_id: text('unidad_id').notNull().references(() => unidad.id),
  cantidad_minima: integer('cantidad_minima').notNull(),
  cantidad_maxima: integer('cantidad_maxima'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Solicitudes ────────────────────────────────────────────────────────
export const solicitud = sqliteTable('solicitud', {
  id: text('id').primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10)),
  tipo: text('tipo').notNull(),
  caller_id: integer('caller_id').notNull().references(() => persona.codigo),
  data: text('data').notNull(),
  estado: text('estado').notNull().default('pendiente'),
  aprobada: integer('aprobada'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Documentos ─────────────────────────────────────────────────────────
export const documento = sqliteTable('documento', {
  id: text('id').primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10)),
  tipo: text('tipo').notNull(),
  caller_id: integer('caller_id').notNull().references(() => persona.codigo),
  data: text('data').notNull(),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Asistencia ─────────────────────────────────────────────────────────
export const asistencia = sqliteTable('asistencia', {
  id: text('id').primaryKey(),
  persona_id: integer('persona_id').notNull().references(() => persona.codigo),
  entrada: text('entrada').notNull(),
  salida: text('salida'),
});

// ─── Evento ────────────────────────────────────────────────────────────
export const evento = sqliteTable('evento', {
  id: text('id').primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10)),
  persona_id: integer('persona_id').notNull().references(() => persona.codigo),
  fecha: text('fecha').notNull(),
  data: text('data').notNull(),
  created_at: text('created_at').default(sql`(datetime('now'))`),
});

// ─── Registro Auditoria ────────────────────────────────────────────────
export const registro_auditoria = sqliteTable('registro_auditoria', {
  id: text('id').primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10)),
  persona_id: integer('persona_id'),
  operacion: text('operacion').notNull(),
  entidad: text('entidad'),
  entidad_id: text('entidad_id'),
  data: text('data').notNull().default('{}'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
});

// ─── Contrato ──────────────────────────────────────────────────────────
export const contrato = sqliteTable('contrato', {
  id: text('id').primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10)),
  empleo_id: text('empleo_id').notNull().references(() => empleo.id),
  tipo: text('tipo').notNull(),
  fecha_inicio: text('fecha_inicio').notNull(),
  fecha_fin: text('fecha_fin'),
  sueldo: text('sueldo').notNull(),
  data: text('data').notNull().default('{}'),
  version: integer('version').notNull().default(1),
  estado: text('estado').notNull().default('activo'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Saldo Vacaciones ──────────────────────────────────────────────────
export const saldo_vacaciones = sqliteTable('saldo_vacaciones', {
  id: text('id').primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10)),
  persona_id: integer('persona_id').notNull().references(() => persona.codigo),
  periodo: integer('periodo').notNull(),
  dias_acumulados: integer('dias_acumulados').notNull().default(15),
  dias_usados: integer('dias_usados').notNull().default(0),
  dias_reservados: integer('dias_reservados').notNull().default(0),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Carnet ────────────────────────────────────────────────────────────
export const carnet = sqliteTable('carnet', {
  id: text('id').primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10)),
  persona_id: integer('persona_id').notNull().references(() => persona.codigo),
  numero: text('numero').notNull(),
  estado: text('estado').notNull().default('activo'),
  fecha_emision: text('fecha_emision').notNull(),
  fecha_devolucion: text('fecha_devolucion'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Asignacion Activo ─────────────────────────────────────────────────
export const asignacion_activo = sqliteTable('asignacion_activo', {
  id: text('id').primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10)),
  persona_id: integer('persona_id').notNull().references(() => persona.codigo),
  tipo: text('tipo').notNull(),
  descripcion: text('descripcion').notNull(),
  talla: text('talla'),
  cantidad: integer('cantidad').notNull().default(1),
  fecha_entrega: text('fecha_entrega').notNull(),
  fecha_devolucion: text('fecha_devolucion'),
  estado: text('estado').notNull().default('asignado'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Capacitacion ──────────────────────────────────────────────────────
export const capacitacion = sqliteTable('capacitacion', {
  id: text('id').primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10)),
  persona_id: integer('persona_id').notNull().references(() => persona.codigo),
  tipo: text('tipo').notNull(),
  nombre: text('nombre').notNull(),
  fecha: text('fecha').notNull(),
  fecha_vencimiento: text('fecha_vencimiento'),
  estado: text('estado').notNull().default('pendiente'),
  data: text('data').notNull().default('{}'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── Caso Disciplinario ────────────────────────────────────────────────
export const caso_disciplinario = sqliteTable('caso_disciplinario', {
  id: text('id').primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10)),
  persona_id: integer('persona_id').notNull().references(() => persona.codigo),
  tipo: text('tipo').notNull(),
  descripcion: text('descripcion').notNull(),
  fecha: text('fecha').notNull(),
  estado: text('estado').notNull().default('abierto'),
  data: text('data').notNull().default('{}'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

