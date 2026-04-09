# Lukuma System

## What This Is

An HR and workforce management system for an Ecuadorian flower farm (floriculture company). It manages employees, organizational structure, job roles, payroll banking, attendance tracking, and cost accounting across multiple production farms.

The entire backend is a single Express API backed by SQLite via Drizzle ORM.

---

## Architecture

Three source files, one database:

```
src/engine.js      — Express server, JWT auth middleware, single RPC endpoint
src/database.js    — Drizzle ORM schema definitions (7 tables)
src/operations.js  — All business logic as named functions in a flat map
system.db          — SQLite database (the single source of truth)
```

### How the API Works

All requests go through one endpoint: `POST /api/:operation`. The operation name maps to a function in `operations.js`. This is RPC-style, not REST.

Every request re-imports modules (for hot-reload during dev). JWT token is extracted from the `Authorization: Bearer <token>` header. Most operations require authentication via `requireCaller()`.

Login returns a JWT containing `{ codigo, nombres, apellidos }` where `codigo` is the persona's primary key.

There is a raw SQL escape hatch (`query` operation) restricted to persona codigo `100649`.

### Self-Documenting

The `listOperations` operation introspects all function source code to report which operations exist, whether they require auth, and what input fields they expect.

---

## The Business

The company operates flower farms in Ecuador. The workforce is organized around the flower production lifecycle: growing (cultivo), spraying (fumigacion), post-harvest processing (poscosecha), and supporting operations (maintenance, irrigation, administration, sales).

### Locations

| Sucursal (branch) | Alias   | Role                     | Employees |
|--------------------|---------|--------------------------|-----------|
| Santa Maria        | Finca 1 | Production farm          | ~187      |
| Cananvalle         | Finca 2 | Production farm          | ~191      |
| San Camilo         | Finca 3 | Smaller production farm  | ~72       |
| Ofi. Quito         | —       | Headquarters / admin     | ~15       |
| Finca Vtas         | —       | Sales outpost            | ~1        |

The aliases "Finca 1", "Finca 2", "Finca 3" are stored in the `alias` table. These correspond to the F1/F2/F3 suffixes that historically appeared in cost structure strings.

---

## Database Schema

### persona — People

Every person in the system: employees, retirees, interns.

| Column             | Type    | Notes                                  |
|--------------------|---------|----------------------------------------|
| codigo             | INTEGER | **PK**. Internal employee number       |
| cedula             | INTEGER | Ecuadorian national ID. Unique         |
| apellidos          | TEXT    | Last names                             |
| nombres            | TEXT    | First names                            |
| fecha_nacimiento   | TEXT    | Birth date                             |
| lugar_nacimiento   | TEXT    | Birth place                            |
| sexo               | TEXT    | `Femenino`, `Masculino`                |
| estado_civil       | TEXT    | `Soltero`, `Casado`, `Union libre`, `Divorciado`, `Viudo` |
| cargas_familiares  | INTEGER | Number of dependents                   |
| titulo             | TEXT    | Academic title                         |
| profesion          | TEXT    | Profession                             |
| email              | TEXT    |                                        |
| movil              | TEXT    | Mobile phone                           |
| telefono           | TEXT    | Landline                               |
| lugar_residencia   | TEXT    | City/town of residence                 |
| calle              | TEXT    | Street                                 |
| referencia         | TEXT    | Address reference/landmark             |
| casa_numero        | TEXT    | House number                           |
| usuario            | TEXT    | Login username (set to cedula)         |
| contrasena         | TEXT    | Login password (plaintext)             |
| created_at         | TEXT    | Auto-set datetime                      |
| updated_at         | TEXT    | Auto-set datetime                      |

**Codigo numbering**: codes are in ranges 100xxx, 200xxx, 300xxx — legacy numbering from different entry batches, not finca-specific.

All 466 personas currently have login credentials set (usuario = cedula number).

---

### unidad — Organizational Units

A self-referencing tree representing the company structure. 4 levels deep:

```
empresa → sucursal → grupo → area
```

| Column    | Type | Notes                                         |
|-----------|------|-----------------------------------------------|
| id        | TEXT | **PK**. Short UUID                            |
| nombre    | TEXT | Unit name                                     |
| tipo      | TEXT | `empresa`, `sucursal`, `grupo`, `area`        |
| parent_id | TEXT | FK → unidad.id. NULL for the root (empresa)   |

**The full tree:**

```
La empresa (empresa)
├── Santa Maria (sucursal) — "Finca 1"
│   ├── Cultivo (grupo)
│   │   ├── Area 1, Area 2, Area 3
│   ├── Poscosecha (grupo)
│   ├── Fumigacion (grupo)
│   ├── Mantenimiento (grupo)
│   ├── Riego (grupo)
│   ├── Comedor (grupo)
│   ├── Administracion (grupo)
│   ├── Comercializacion (grupo)
│   └── Pers. Discapacitado (grupo)
│
├── Cananvalle (sucursal) — "Finca 2"
│   ├── Cultivo (grupo)
│   │   ├── Area 1, Area 2, Area 3, Area 4
│   ├── Poscosecha (grupo)
│   ├── Fumigacion (grupo)
│   ├── Mantenimiento (grupo)
│   ├── Riego (grupo)
│   ├── Taller (grupo)
│   ├── Administracion (grupo)
│   └── Pers. Discapacitado (grupo)
│
├── San Camilo (sucursal) — "Finca 3"
│   ├── Cultivo (grupo)
│   │   ├── Area 1, Area 2, Area 4
│   ├── Mantenimiento (grupo)
│   └── Administracion (grupo)
│
├── Ofi. Quito (sucursal)
│   ├── Administracion (grupo)
│   └── Comercializacion (grupo)
│
└── Finca Vtas (sucursal)
    └── Comercializacion (grupo)
```

**Key insight**: Areas only exist under Cultivo grupos. They represent physical growing zones within a farm. All other grupos (Poscosecha, Fumigacion, etc.) do not subdivide further.

Employees are assigned to either a **grupo** (309 people) or an **area** (157 people). Areas are only used in Cultivo.

---

### cargo — Job Roles

Defines a position type, independent of where in the org someone works.

| Column       | Type | Notes                                        |
|--------------|------|----------------------------------------------|
| id           | TEXT | **PK**. Short UUID                           |
| rol_base     | TEXT | Generic role level (e.g. TRABAJADOR, JEFE)   |
| especialidad | TEXT | Specific function (e.g. CULTIVO, EMBONCHE)   |
| codigo_iess  | TEXT | IESS (social security) occupational code     |

The job title is the combination of `rol_base` + `especialidad`. All 70 cargos are currently in use.

**Role hierarchy** (from field to executive):

- **TRABAJADOR** — Field/floor workers. The bulk of the workforce (~340). Specializations include: CULTIVO, DEL AGRO, CLASIFICACION, EMBONCHE, FUMIGACION, EXTERIORES, MANTENIMIENTO, RECEPCION, EMPAQUE, RIEGO, CAPUCHONES, PATINADOR DE SALA, COCHERO DE CULTIVO, DRENCH, LIGAS, CONTEO DE BOTONES, TINTURADO, GUILLOTINA, LAVADO DE FOLLAJE, COMPOSTERA, NACIONAL, TALLER, MONITOREO CULTIVO, CONTROL DE CALIDAD, LIMPIEZA DE SALA, PREVENCIÓN SANITARIA, TRABAJADOR/A SOCIAL, TRACTORISTA, DE DATOS
- **OPERARIO** — Operators (BODEGA)
- **BOMBERO** — Spraying technicians (FUMIGACION)
- **SUPERVISOR** — Supervisors (CULTIVO, FUMIGACION, MANTENIMIENTO, FERTILIZACION, TINTURADO, GENERAL)
- **JEFE** — Department heads (CULTIVO, EMPAQUE, FINANCIERO, GENERAL DE POSCOSECHA, CALIDAD PROCESOS Y MANTENIMIENTO, DESARROLLO TECNOLOGICO)
- **GERENTE** — Managers (PRODUCCION, POSCOSECHA, TALENTO HUMANO)
- **SUBGERENTE** — Deputy manager (SUBGENERAL)
- **DIRECTOR** — Director (SISTEMAS Y COMUNICACIONES)
- **Support roles**: ASISTENTE, AUXILIAR, CHOFER, CONTADOR, COORDINADOR, DOCTOR, ENFERMERA, EJECUTIVA, MENSAJERO, TECNICO, AUDITOR
- **Special**: PASANTE (intern), JUBILADO (retiree), INGRESO (intake)

---

### empleo — Employment Records

Links a persona to a cargo at a specific unidad. This is the central relationship table.

| Column             | Type    | Notes                                                |
|--------------------|---------|------------------------------------------------------|
| id                 | TEXT    | **PK**. Short UUID                                   |
| persona_id         | INTEGER | FK → persona.codigo                                  |
| cargo_id           | TEXT    | FK → cargo.id                                        |
| unidad_id          | TEXT    | FK → unidad.id (the grupo or area they work in)      |
| banco_id           | TEXT    | FK → banco.id (payroll bank)                         |
| tipo_contrato      | TEXT    | `PLAZO FIJO`, `PASANTIA`, `JUBILACION`               |
| fecha_inicio       | TEXT    | Contract start date                                  |
| fecha_fin          | TEXT    | Contract end date. NULL = currently active            |
| numero_cuenta      | TEXT    | Bank account number                                  |
| alterno            | INTEGER | Badge/biometric ID for attendance systems            |
| perfil_horario     | TEXT    | Work schedule (see below)                            |
| estructura_costos  | TEXT    | Accounting cost center (see below)                   |

**Current state**: 466 empleos, all active (fecha_fin is NULL for everyone). 1:1 with persona currently, though the schema supports multiple empleos per persona. Contracts date back to 1988.

**perfil_horario** (work schedules):

| Schedule                 | Count | Who                              |
|--------------------------|-------|----------------------------------|
| Horario Postcosecha y HE | 300   | Most workers (includes overtime) |
| Horario Cultivo          | 151   | Cultivo field workers            |
| Horario Administrativo   | 13    | Office staff and interns         |
| Horario Postcosecha      | 1     | Single worker                    |
| Horario Fumigacion       | 1     | Single worker                    |

"HE" = Horas Extra (overtime).

**estructura_costos** (cost centers for accounting):

| Cost Center                            | Count | Meaning                              |
|----------------------------------------|-------|--------------------------------------|
| Produccion Mano de Obra Directa        | 306   | Direct production labor              |
| Mano de Obra Poscosecha               | 86    | Post-harvest labor                   |
| Gastos Administrativos..               | 36    | Administrative expenses              |
| MOI Mantenimiento y servicios general  | 22    | Indirect maintenance labor           |
| Ventas General                         | 8     | Sales costs                          |
| MOI Tecnica Administrativa             | 5     | Indirect technical/admin labor       |
| MOI Area de Riego                      | 3     | Indirect irrigation labor            |

The cost center is an independent accounting classification — it does NOT follow organizational structure mechanically. A person in the Cultivo grupo might be charged to Gastos Administrativos, and vice versa.

**alterno**: A badge or biometric identifier. ~270 employees have one, ~196 don't. Values are non-sequential unique integers. Used for physical attendance systems.

---

### banco — Banks

Ecuadorian banks for payroll deposits.

| Column | Type | Notes           |
|--------|------|-----------------|
| id     | TEXT | **PK**. UUID    |
| nombre | TEXT | Bank name       |

Current banks: PICHINCHA (212 employees), GUAYAQUIL (178), AUSTRO (56), PRODUBANCO (18), PACIFICO (2).

---

### alias — Sucursal Aliases

Maps sucursales to their common short names.

| Column    | Type | Notes                      |
|-----------|------|----------------------------|
| unidad_id | TEXT | **PK**, FK → unidad.id     |
| alias     | TEXT | The short name             |

Only 3 entries: Santa Maria → "Finca 1", Cananvalle → "Finca 2", San Camilo → "Finca 3".

---

### asistencia — Attendance

Clock-in / clock-out records.

| Column     | Type    | Notes                          |
|------------|---------|--------------------------------|
| id         | TEXT    | **PK**                         |
| persona_id | INTEGER | FK → persona.codigo            |
| entrada    | TEXT    | Clock-in timestamp (ISO 8601)  |
| salida     | TEXT    | Clock-out timestamp. NULL = still clocked in |

Supports individual and bulk (masiva) operations. An employee can only have one open entry at a time (no salida = still working). Currently 1 record in the table.

---

## Work Domains

These are the functional areas of the flower farm business:

| Domain           | What Happens                                          | Unidad Type |
|------------------|-------------------------------------------------------|-------------|
| **Cultivo**      | Growing flowers in field areas (planting, monitoring, harvesting buds) | grupo + areas |
| **Poscosecha**   | Post-harvest processing: classification, bunching (embonche), packing, quality control | grupo |
| **Fumigacion**   | Crop protection spraying                              | grupo       |
| **Mantenimiento**| Physical infrastructure upkeep, exteriors, composting | grupo       |
| **Riego**        | Irrigation systems and drench application             | grupo       |
| **Comedor**      | On-site cafeteria (Finca 1 only)                      | grupo       |
| **Taller**       | Workshop/repairs (Finca 2 only)                       | grupo       |
| **Administracion**| Finance, HR, IT, health, safety, logistics, warehouse | grupo       |
| **Comercializacion** | Sales and client coordination                     | grupo       |
| **Pers. Discapacitado** | Employees with disabilities (special tracking) | grupo       |

---

## Relationships Summary

```
persona ←──1:1──→ empleo ──→ cargo    (what they do)
                         ──→ unidad   (where they work)
                         ──→ banco    (how they get paid)

persona ←──1:N──→ asistencia          (attendance log)

unidad  ←──self──→ unidad.parent_id   (org tree: empresa→sucursal→grupo→area)
unidad  ←──1:1──→ alias               (only 3 sucursales have aliases)
```

To determine which finca an employee belongs to: walk `empleo.unidad_id` up through `unidad.parent_id` until you reach a sucursal, then check `alias` for the finca name.

---

## Tech Stack

- **Runtime**: Node.js (ESM modules)
- **Server**: Express 5
- **Database**: SQLite via better-sqlite3
- **ORM**: Drizzle ORM
- **Auth**: JWT (jsonwebtoken)
- **Schema migrations**: drizzle-kit (generate/migrate/push)
