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
  nombre: text('nombre').notNull().unique(),
  codigo_iess: text('codigo_iess'),
  perfil_horario: text('perfil_horario'),
  estructura_costos: text('estructura_costos'),
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

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').notNull().primaryKey(),
  usuario: text('usuario').notNull().unique(),
  contrasena: text('contrasena').notNull(),
  role: text('role').notNull(),
  persona_id: integer('persona_id').references(() => persona.codigo),
  name: text('name').notNull(),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
