// processes/hiring.js
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { eq, and } from 'drizzle-orm';
import { db, empleo, documento } from '../database.js';
import puppeteer from 'puppeteer';
import QRCode from 'qrcode';

// --- Constants ---
const TALENTO_HUMANO_ID = 'daad7b97';
const LUCAS_ID = 100649;
const API_BASE = process.env.API_BASE || `http://localhost:${process.env.PORT || 3001}`;
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// --- Helpers ---

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function requireTalentoHumano(caller) {
    if (!caller) throw new Error('not authenticated');
    if (caller.codigo === LUCAS_ID) return;
    const [emp] = await db.select().from(empleo)
        .where(and(eq(empleo.persona_id, caller.codigo), eq(empleo.unidad_id, TALENTO_HUMANO_ID)));
    if (!emp) throw new Error('unauthorized — solo Lucas o Talento Humano');
}

async function loadPrevDocument(documentoId) {
    if (!documentoId) throw new Error('documento_id is required');
    const [doc] = await db.select().from(documento).where(eq(documento.id, documentoId));
    if (!doc) throw new Error('documento not found');
    return JSON.parse(doc.data);
}

function dateInfo() {
    const now = new Date();
    return {
        fecha: now.toISOString().split('T')[0],
        dia: now.getDate(),
        mes: MESES[now.getMonth()],
        ano: now.getFullYear(),
    };
}

function callerName(caller) {
    return `${caller.nombres || ''} ${caller.apellidos || ''}`.trim();
}

function readTemplate(name) {
    return readFileSync(new URL(`../documents/${name}`, import.meta.url), 'utf8');
}

function blank(val) {
    return val || '_______________';
}

function replaceAll(template, replacements) {
    let result = template;
    for (const [key, value] of Object.entries(replacements))
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    return result;
}

function formField(name, value, { label, placeholder, spanClass = 'val', inputClass, inputName } = {}) {
    const lbl = label ? `<label>${escapeHtml(label)}</label>` : '';
    if (value) {
        return `${lbl}<span class="${spanClass}" id="f_${escapeHtml(name)}">${escapeHtml(value)}</span>`;
    }
    const cls = inputClass ? ` class="${inputClass}"` : '';
    const nm = inputName ? ` name="${escapeHtml(name)}"` : '';
    return `${lbl}<input${cls}${nm} id="f_${escapeHtml(name)}" placeholder="${escapeHtml(placeholder || label || '')}">`;
}

function applyFormBase(template, { caller, prefillData, cleanupUrls }) {
    return template
        .replace(/\{\{api_base\}\}/g, API_BASE)
        .replace(/\{\{token\}\}/g, caller._token || '')
        .replace(/\{\{prefill_json\}\}/g, JSON.stringify({ ...prefillData, _cleanup: cleanupUrls }));
}

// --- Core pipeline ---

async function generateDocumentSet({ prefix, pdfHtml, formHtml }) {
    const downloadsDir = new URL('../../downloads/', import.meta.url);
    mkdirSync(downloadsDir, { recursive: true });

    const pdfUrl = `/downloads/${prefix}.pdf`;
    const formUrl = `/downloads/${prefix}_form.html`;
    const qrUrl = `/downloads/${prefix}_qr.png`;

    // PDF via Puppeteer
    const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setContent(pdfHtml, { waitUntil: 'networkidle0' });
        const pdfContent = await page.pdf({ format: 'A4', printBackground: true });
        writeFileSync(new URL(`${prefix}.pdf`, downloadsDir), pdfContent);
    } finally {
        await browser.close();
    }

    // Form HTML
    writeFileSync(new URL(`${prefix}_form.html`, downloadsDir), formHtml);

    // QR
    const qrBuffer = await QRCode.toBuffer(`${API_BASE}${formUrl}`);
    writeFileSync(new URL(`${prefix}_qr.png`, downloadsDir), qrBuffer);

    return { pdf: pdfUrl, qr: qrUrl, form: formUrl };
}

function outputUrls(prefix) {
    return {
        pdfUrl: `/downloads/${prefix}.pdf`,
        formUrl: `/downloads/${prefix}_form.html`,
        qrUrl: `/downloads/${prefix}_qr.png`,
    };
}

// --- Hiring pipeline steps ---

export const hiring = {

    consentimientoDeDatos: async function consentimientoDeDatos({ input, caller }) {
        /**
         * Hiring process — step 1 of 11. Generate a data consent PDF and interactive HTML form for a new applicant. Restricted to Talento Humano staff.
         * Next: entrevista.
         * All input fields are optional — unfilled fields become blanks in the PDF and editable inputs in the form. Call with no inputs for a fully blank form, or pre-fill what you know.
         * Input: nombres (string, optional), apellidos (string, optional), cedula (number, optional), ciudad (string, optional), cargo_id (string, optional), unidad_id (string, optional).
         * Output: {pdf: string, qr: string, form: string} — PDF download link, QR code image, and interactive form URL. Always show the QR using ![qr]({API_BASE}{qr}). The form link must be opened via the server URL (not downloaded).
         */
        await requireTalentoHumano(caller);
        const { fecha, dia, mes, ano } = dateInfo();
        const nombres = input.nombres || '';
        const apellidos = input.apellidos || '';
        const cedula = input.cedula || '';
        const ciudad = input.ciudad || '';
        const prefix = `consentimiento_${cedula || 'new'}_${Date.now()}`;
        const { pdfUrl, formUrl, qrUrl } = outputUrls(prefix);

        const pdfHtml = replaceAll(readTemplate('consentimiento_de_datos/consentimiento_de_datos.html'), {
            fecha, dia, mes, ano,
            ciudad: blank(ciudad), nombres: blank(nombres),
            apellidos: blank(apellidos), cedula: blank(cedula),
        });

        let formHtml = replaceAll(readTemplate('consentimiento_de_datos/consentimiento_de_datos_form.html'), {
            fecha, dia, mes, ano,
            field_nombres: formField('nombres', nombres, { placeholder: 'Nombres', spanClass: 'fill', inputClass: 'field', inputName: true }),
            field_apellidos: formField('apellidos', apellidos, { placeholder: 'Apellidos', spanClass: 'fill', inputClass: 'field', inputName: true }),
            field_cedula: formField('cedula', cedula, { placeholder: 'Cedula', spanClass: 'fill', inputClass: 'field', inputName: true }),
            field_ciudad: formField('ciudad', ciudad, { placeholder: 'Ciudad', spanClass: 'fill', inputClass: 'field', inputName: true }),
        });
        formHtml = applyFormBase(formHtml, {
            caller,
            prefillData: { nombres, apellidos, cedula, ciudad, fecha, cargo_id: input.cargo_id || null, unidad_id: input.unidad_id || null },
            cleanupUrls: [pdfUrl, formUrl, qrUrl],
        });

        return generateDocumentSet({ prefix, pdfHtml, formHtml });
    },

    entrevista: async function entrevista({ input, caller }) {
        /**
         * Hiring process — step 2 of 11. Generate an interview sheet (hoja de entrevista) PDF and interactive form. Restricted to Talento Humano staff.
         * Requires: consentimientoDeDatos. Next: datosPersonales.
         * Pre-fills nombres, apellidos, cedula, ciudad from the consentimiento. All other fields are collected during the interview. Two signatures: entrevistado and entrevistador (caller).
         * Input: documento_id (string, required — id of the consentimiento_de_datos documento), plus any optional fields to pre-fill.
         * Output: {pdf: string, qr: string, form: string}. Always show the QR using ![qr]({API_BASE}{qr}). The form link must be opened via the server URL.
         */
        await requireTalentoHumano(caller);
        const prev = await loadPrevDocument(input.documento_id);
        const { fecha } = dateInfo();
        const d = { ...prev, ...input };
        if (d.cedula && !d.tipo_id) d.tipo_id = 'Cédula';
        const v = (key) => d[key] || '';
        const entrevistador = callerName(caller);
        const prefix = `entrevista_${prev.cedula || 'new'}_${Date.now()}`;
        const { pdfUrl, formUrl, qrUrl } = outputUrls(prefix);

        // PDF
        const allFields = ['fecha','tipo_id','cedula','apellidos','nombres','sexo','fecha_nacimiento','estado_civil','tipo_sangre','estatura','peso',
            'lugar_nacimiento','lugar_residencia','calle','casa_numero','referencia',
            'movil','telefono1','telefono2','email','email_alt','profesion','titulo',
            'cargo','perfil_cargo','fecha_ingreso','sueldo','relacion_laboral','seguro_social','perfil_horario','tipo_pago_mrl',
            'estructura_costos','departamento','finca','grupo_nomina','plantilla',
            'forma_pago','banco','tipo_cuenta','numero_cuenta','entrevistador'];
        const pdfReplacements = { fecha, entrevistador };
        for (const f of allFields) pdfReplacements[f] = pdfReplacements[f] || blank(v(f));
        const pdfHtml = replaceAll(readTemplate('entrevista/entrevista.html'), pdfReplacements);

        // Form
        const fieldDefs = [
            ['tipo_id','Tipo ID','Cédula'], ['cedula','Cédula'], ['apellidos','Apellidos'], ['nombres','Nombres'],
            ['sexo','Sexo'], ['fecha_nacimiento','Fecha Nacimiento','AAAA-MM-DD'], ['estado_civil','Estado Civil'],
            ['tipo_sangre','Tipo Sangre'], ['estatura','Estatura (m)'], ['peso','Peso (lb)'],
            ['lugar_nacimiento','Lugar Nacimiento'], ['lugar_residencia','Lugar Residencia'],
            ['calle','Calle'], ['casa_numero','Casa N°'], ['referencia','Referencia'],
            ['movil','Móvil'], ['telefono1','Teléfono 1'], ['telefono2','Teléfono 2'],
            ['email','Email'], ['email_alt','Email alt.'], ['profesion','Profesión'], ['titulo','Título'],
            ['cargo','Cargo'], ['perfil_cargo','Perfil Cargo'], ['fecha_ingreso','Fecha Ingreso','AAAA-MM-DD'],
            ['sueldo','Sueldo'], ['relacion_laboral','Rel. Laboral'], ['seguro_social','Seguro Social'],
            ['perfil_horario','Perfil Horario'], ['tipo_pago_mrl','Tipo Pago MRL'],
            ['estructura_costos','Estr. Costos'], ['departamento','Departamento'], ['finca','Finca'],
            ['grupo_nomina','Grupo Nómina'], ['plantilla','Plantilla'], ['forma_pago','Forma Pago'],
            ['banco','Banco'], ['tipo_cuenta','Tipo Cuenta'], ['numero_cuenta','N° Cuenta'],
        ];
        const formReplacements = { fecha };
        for (const [name, label, ph] of fieldDefs)
            formReplacements[`f_${name}`] = formField(name, v(name), { label, placeholder: ph });
        let formHtml = replaceAll(readTemplate('entrevista/entrevista_form.html'), formReplacements);
        formHtml = applyFormBase(formHtml, {
            caller,
            prefillData: { ...d, fecha, consentimiento_id: input.documento_id, _entrevistador: entrevistador },
            cleanupUrls: [pdfUrl, formUrl, qrUrl],
        });

        return generateDocumentSet({ prefix, pdfHtml, formHtml });
    },

    datosPersonales: async function datosPersonales({ input, caller }) {
        /**
         * Hiring process — step 3 of 11. Generate a personal data sheet (datos personales) PDF and interactive form. Restricted to Talento Humano staff.
         * Requires: entrevista. Next: actaEntrega.
         * Pre-fills identification and banking from entrevista. New fields collected: tallas, ruta de transporte, croquis de vivienda, firma del trabajador.
         * Input: documento_id (string, required — id of the entrevista documento), plus any optional fields to pre-fill.
         * Output: {pdf: string, qr: string, form: string}. Always show the QR using ![qr]({API_BASE}{qr}). The form link must be opened via the server URL.
         */
        await requireTalentoHumano(caller);
        const prev = await loadPrevDocument(input.documento_id);
        const { fecha } = dateInfo();
        const d = { ...prev, ...input };
        const v = (key) => d[key] || '';
        const prefix = `datos_${prev.cedula || 'new'}_${Date.now()}`;
        const { pdfUrl, formUrl, qrUrl } = outputUrls(prefix);

        // PDF
        const pdfFields = ['fecha_ingreso','cedula','apellidos','nombres','area_ingreso',
            'banco','tipo_cuenta','numero_cuenta',
            'talla_mandil','talla_camiseta','talla_botas','talla_zapatos','ruta','parada'];
        const pdfReplacements = { fecha };
        for (const f of pdfFields) pdfReplacements[f] = blank(v(f));
        const pdfHtml = replaceAll(readTemplate('datos_personales/datos_personales.html'), pdfReplacements);

        // Form
        const fieldDefs = [
            ['fecha_ingreso','Fecha Ingreso','AAAA-MM-DD'], ['cedula','Cédula'], ['apellidos','Apellidos'],
            ['nombres','Nombres'], ['area_ingreso','Area Ingreso'], ['banco','Banco'],
            ['tipo_cuenta','Tipo Cuenta'], ['numero_cuenta','N° Cuenta'],
            ['talla_mandil','Talla Mandil'], ['talla_camiseta','Talla Camiseta'],
            ['talla_botas','Talla Botas'], ['talla_zapatos','Talla Zapatos'],
            ['ruta','Ruta'], ['parada','Parada'],
        ];
        const formReplacements = { fecha };
        for (const [name, label, ph] of fieldDefs)
            formReplacements[`f_${name}`] = formField(name, v(name), { label, placeholder: ph });
        let formHtml = replaceAll(readTemplate('datos_personales/datos_personales_form.html'), formReplacements);
        formHtml = applyFormBase(formHtml, {
            caller,
            prefillData: { ...d, fecha, entrevista_id: input.documento_id },
            cleanupUrls: [pdfUrl, formUrl, qrUrl],
        });

        return generateDocumentSet({ prefix, pdfHtml, formHtml });
    },

    actaEntrega: async function actaEntrega({ input, caller }) {
        /**
         * Hiring process — step 4 of 11. Generate a document delivery and socialization act (acta de entrega). Restricted to Talento Humano staff.
         * Requires: datosPersonales. Next: cartaCompromiso.
         * Pre-fills worker data from previous documents. The checklist of documents is fixed. Two signatures: worker and Talento Humano (caller).
         * Input: documento_id (string, required — id of the datosPersonales documento).
         * Output: {pdf: string, qr: string, form: string}. Always show the QR using ![qr]({API_BASE}{qr}). The form link must be opened via the server URL.
         */
        await requireTalentoHumano(caller);
        const prev = await loadPrevDocument(input.documento_id);
        const { fecha, dia, mes, ano } = dateInfo();
        const d = { ...prev, ...input };
        const talentoHumano = callerName(caller);
        const prefix = `acta_${prev.cedula || 'new'}_${Date.now()}`;
        const { pdfUrl, formUrl, qrUrl } = outputUrls(prefix);

        const shared = { fecha, dia, mes, ano, ciudad: d.ciudad || '', nombres: d.nombres || '', apellidos: d.apellidos || '', cedula: d.cedula || '' };

        const pdfHtml = replaceAll(readTemplate('acta_entrega/acta_entrega.html'), {
            ...shared, ciudad: blank(shared.ciudad), nombres: blank(shared.nombres),
            apellidos: blank(shared.apellidos), cedula: blank(shared.cedula), talento_humano: talentoHumano,
        });

        let formHtml = replaceAll(readTemplate('acta_entrega/acta_entrega_form.html'), { ...shared, talento_humano: talentoHumano });
        formHtml = applyFormBase(formHtml, {
            caller,
            prefillData: { ...shared, entrevista_id: input.documento_id, _talento_humano: talentoHumano },
            cleanupUrls: [pdfUrl, formUrl, qrUrl],
        });

        return generateDocumentSet({ prefix, pdfHtml, formHtml });
    },

    cartaCompromiso: async function cartaCompromiso({ input, caller }) {
        /**
         * Hiring process — step 5 of 11. Generate a commitment letter with the management system (carta de compromiso SIG). Restricted to Talento Humano staff.
         * Requires: actaEntrega. Next: decimos.
         * Pre-fills worker data from previous documents. Content is fixed legal text. Two signatures: worker and Dep. Talento Humano (caller).
         * Input: documento_id (string, required — id of the actaEntrega documento).
         * Output: {pdf: string, qr: string, form: string}. Always show the QR using ![qr]({API_BASE}{qr}). The form link must be opened via the server URL.
         */
        await requireTalentoHumano(caller);
        const prev = await loadPrevDocument(input.documento_id);
        const { fecha, dia, mes, ano } = dateInfo();
        const d = { ...prev, ...input };
        const talentoHumano = callerName(caller);
        const prefix = `compromiso_${prev.cedula || 'new'}_${Date.now()}`;
        const { pdfUrl, formUrl, qrUrl } = outputUrls(prefix);

        const shared = { fecha, dia, mes, ano, ciudad: d.ciudad || '', nombres: d.nombres || '', apellidos: d.apellidos || '', cedula: d.cedula || '' };

        const pdfHtml = replaceAll(readTemplate('carta_compromiso/carta_compromiso.html'), {
            ...shared, ciudad: blank(shared.ciudad), nombres: blank(shared.nombres),
            apellidos: blank(shared.apellidos), cedula: blank(shared.cedula), talento_humano: talentoHumano,
        });

        let formHtml = replaceAll(readTemplate('carta_compromiso/carta_compromiso_form.html'), { ...shared, talento_humano: talentoHumano });
        formHtml = applyFormBase(formHtml, {
            caller,
            prefillData: { ...shared, entrevista_id: input.documento_id, _talento_humano: talentoHumano },
            cleanupUrls: [pdfUrl, formUrl, qrUrl],
        });

        return generateDocumentSet({ prefix, pdfHtml, formHtml });
    },

    decimos: async function decimos({ input, caller }) {
        /**
         * Hiring process — step 6 of 11. Generate a voluntary request for decimos payment method. Restricted to Talento Humano staff.
         * Requires: cartaCompromiso. Next: induccion.
         * Pre-fills worker data from previous documents. Worker chooses monthly vs accumulated for 13th and 14th salary. One signature: worker only.
         * Input: documento_id (string, required — id of the cartaCompromiso documento).
         * Output: {pdf: string, qr: string, form: string}. Always show the QR using ![qr]({API_BASE}{qr}). The form link must be opened via the server URL.
         */
        await requireTalentoHumano(caller);
        const prev = await loadPrevDocument(input.documento_id);
        const { fecha, dia, mes, ano } = dateInfo();
        const d = { ...prev, ...input };
        const nombres = d.nombres || '';
        const apellidos = d.apellidos || '';
        const cedula = d.cedula || '';
        const ciudad = d.ciudad || '';
        const d13 = d.decimo_tercero || 'mensual';
        const d14 = d.decimo_cuarto || 'mensual';
        const prefix = `decimos_${cedula || 'new'}_${Date.now()}`;
        const { pdfUrl, formUrl, qrUrl } = outputUrls(prefix);

        const pdfHtml = replaceAll(readTemplate('decimos/decimos.html'), {
            fecha, dia, mes, ano,
            ciudad: blank(ciudad), nombres: blank(nombres), apellidos: blank(apellidos), cedula: blank(cedula),
            d13_acumulado: d13 === 'acumulado' ? 'X' : '', d13_mensual: d13 === 'mensual' ? 'X' : '',
            d14_acumulado: d14 === 'acumulado' ? 'X' : '', d14_mensual: d14 === 'mensual' ? 'X' : '',
        });

        let formHtml = replaceAll(readTemplate('decimos/decimos_form.html'), {
            fecha, dia, mes, ano, ciudad, nombres, apellidos, cedula,
        });
        formHtml = applyFormBase(formHtml, {
            caller,
            prefillData: { nombres, apellidos, cedula, ciudad, fecha, entrevista_id: input.documento_id },
            cleanupUrls: [pdfUrl, formUrl, qrUrl],
        });

        return generateDocumentSet({ prefix, pdfHtml, formHtml });
    },

    induccion: async function induccion({ input, caller }) {
        /**
         * Hiring process — step 7 of 11. Generate a new employee induction record (induccion al personal nuevo). Restricted to Talento Humano staff.
         * Requires: decimos. Next: consentimientoEnrolamiento.
         * Pre-fills worker data from previous documents. Checklist of induction topics across 8 groups, observations fields, two signatures: worker and capacitador (caller).
         * Input: documento_id (string, required — id of the decimos documento), area_puesto (string, optional).
         * Output: {pdf: string, qr: string, form: string}. Always show the QR using ![qr]({API_BASE}{qr}). The form link must be opened via the server URL.
         */
        await requireTalentoHumano(caller);
        const prev = await loadPrevDocument(input.documento_id);
        const { fecha } = dateInfo();
        const d = { ...prev, ...input };
        const nombres = d.nombres || '';
        const apellidos = d.apellidos || '';
        const cedula = d.cedula || '';
        const areaPuesto = d.area_puesto || '';
        const capacitador = callerName(caller);
        const prefix = `induccion_${cedula || 'new'}_${Date.now()}`;
        const { pdfUrl, formUrl, qrUrl } = outputUrls(prefix);

        const pdfHtml = replaceAll(readTemplate('induccion/induccion.html'), {
            fecha, nombres: blank(nombres), apellidos: blank(apellidos), cedula: blank(cedula),
            area_puesto: blank(areaPuesto), capacitador,
            evaluacion: d.evaluacion || '', recomendaciones: d.recomendaciones || '', retroalimentacion: d.retroalimentacion || '',
        });

        let formHtml = replaceAll(readTemplate('induccion/induccion_form.html'), {
            fecha, nombres, apellidos, cedula,
            f_area_puesto: formField('area_puesto', areaPuesto, { placeholder: 'Area / Puesto', spanClass: 'fill' }),
        });
        formHtml = applyFormBase(formHtml, {
            caller,
            prefillData: { nombres, apellidos, cedula, ciudad: d.ciudad || '', fecha, area_puesto: areaPuesto, decimos_id: input.documento_id },
            cleanupUrls: [pdfUrl, formUrl, qrUrl],
        });

        return generateDocumentSet({ prefix, pdfHtml, formHtml });
    },

    consentimientoEnrolamiento: async function consentimientoEnrolamiento({ input, caller }) {
        /**
         * Hiring process — step 8 of 11. Generate data consent for enrollment process (consentimiento enrolamiento SIG-TTHH-RG-09). Restricted to Talento Humano staff.
         * Requires: induccion. Next: evaluacionInduccion.
         * Pre-fills worker data from previous documents. 32-item table of personal data and their legal purposes. Fixed legal text.
         * Two signatures: employer (representante legal) and worker.
         * Input: documento_id (string, required — id of the induccion documento).
         * Output: {pdf: string, qr: string, form: string}. Always show the QR using ![qr]({API_BASE}{qr}). The form link must be opened via the server URL.
         */
        await requireTalentoHumano(caller);
        const prev = await loadPrevDocument(input.documento_id);
        const { fecha, dia, mes, ano } = dateInfo();
        const d = { ...prev, ...input };
        const shared = { fecha, dia, mes, ano, ciudad: d.ciudad || '', nombres: d.nombres || '', apellidos: d.apellidos || '', cedula: d.cedula || '', fecha_ingreso: d.fecha_ingreso || '' };
        const prefix = `enrolamiento_${shared.cedula || 'new'}_${Date.now()}`;
        const { pdfUrl, formUrl, qrUrl } = outputUrls(prefix);

        const pdfHtml = replaceAll(readTemplate('consentimiento_enrolamiento/consentimiento_enrolamiento.html'), {
            ...shared, ciudad: blank(shared.ciudad), nombres: blank(shared.nombres),
            apellidos: blank(shared.apellidos), cedula: blank(shared.cedula), fecha_ingreso: blank(shared.fecha_ingreso),
        });

        let formHtml = replaceAll(readTemplate('consentimiento_enrolamiento/consentimiento_enrolamiento_form.html'), shared);
        formHtml = applyFormBase(formHtml, {
            caller,
            prefillData: { ...shared, induccion_id: input.documento_id },
            cleanupUrls: [pdfUrl, formUrl, qrUrl],
        });

        return generateDocumentSet({ prefix, pdfHtml, formHtml });
    },

    evaluacionInduccion: async function evaluacionInduccion({ input, caller }) {
        /**
         * Hiring process — step 9 of 11. Generate an induction evaluation quiz (evaluacion de la induccion SIG-TTHH-RG-10). Restricted to Talento Humano staff.
         * Requires: consentimientoEnrolamiento. Next: evaluacionCompetencias.
         * Pre-fills worker data. 6 multiple-choice questions about company policies, certifications, and safety. Auto-grades on submit.
         * Two signatures: evaluado (worker) and evaluador (caller).
         * Input: documento_id (string, required — id of the consentimientoEnrolamiento documento), area (string, optional).
         * Output: {pdf: string, qr: string, form: string}. Always show the QR using ![qr]({API_BASE}{qr}). The form link must be opened via the server URL.
         */
        await requireTalentoHumano(caller);
        const prev = await loadPrevDocument(input.documento_id);
        const { fecha } = dateInfo();
        const d = { ...prev, ...input };
        const nombres = d.nombres || '';
        const apellidos = d.apellidos || '';
        const cedula = d.cedula || '';
        const area = d.area || d.area_puesto || '';
        const evaluador = callerName(caller);
        const prefix = `evaluacion_${cedula || 'new'}_${Date.now()}`;
        const { pdfUrl, formUrl, qrUrl } = outputUrls(prefix);

        // PDF — all quiz boxes empty
        const pdfReplacements = { fecha, nombres: blank(nombres), apellidos: blank(apellidos), cedula: blank(cedula), area: blank(area), evaluador };
        for (let q = 1; q <= 6; q++) for (const l of ['a','b','c']) pdfReplacements[`q${q}_${l}`] = '';
        const pdfHtml = replaceAll(readTemplate('evaluacion_induccion/evaluacion_induccion.html'), pdfReplacements);

        let formHtml = replaceAll(readTemplate('evaluacion_induccion/evaluacion_induccion_form.html'), {
            fecha, nombres, apellidos, cedula,
            f_area: formField('area', area, { placeholder: 'Area', spanClass: 'fill' }),
        });
        formHtml = applyFormBase(formHtml, {
            caller,
            prefillData: { nombres, apellidos, cedula, fecha, area, consentimiento_enrolamiento_id: input.documento_id },
            cleanupUrls: [pdfUrl, formUrl, qrUrl],
        });

        return generateDocumentSet({ prefix, pdfHtml, formHtml });
    },

    evaluacionCompetencias: async function evaluacionCompetencias({ input, caller }) {
        /**
         * Hiring process — step 10 of 11. Generate a competency evaluation for Cultivo area (SIG-TTHH-RG-11). Restricted to Talento Humano staff.
         * Requires: evaluacionInduccion. Next: evaluacionPostcosecha.
         * Pre-fills worker data. Mix of open-ended and multiple-choice technical questions about cultivation, sanitation, and fumigation.
         * Results section with observations and pass/fail. Three signatures: TTHH (caller), evaluado, and jefe de area/supervisor.
         * Input: documento_id (string, required — id of the evaluacionInduccion documento), cargo (string, optional).
         * Output: {pdf: string, qr: string, form: string}. Always show the QR using ![qr]({API_BASE}{qr}). The form link must be opened via the server URL.
         */
        await requireTalentoHumano(caller);
        const prev = await loadPrevDocument(input.documento_id);
        const { fecha } = dateInfo();
        const d = { ...prev, ...input };
        const nombres = d.nombres || '';
        const apellidos = d.apellidos || '';
        const cedula = d.cedula || '';
        const cargo = d.cargo || '';
        const tthh = callerName(caller);
        const prefix = `competencias_${cedula || 'new'}_${Date.now()}`;
        const { pdfUrl, formUrl, qrUrl } = outputUrls(prefix);

        const pdfReplacements = {
            fecha, nombres: blank(nombres), apellidos: blank(apellidos), cedula: blank(cedula),
            cargo: blank(cargo), tthh, experiencia: '', herramientas: '',
            evaluador_jefe: '', novedades_tthh: '', observacion_jefe: '',
            res_aprobado: '', res_no_aprobado: '',
        };
        for (const k of ['r1','r2','r4','r7','r8a','r8b']) pdfReplacements[k] = '';
        for (const k of ['q3_a','q3_b','q3_c','q5a_1','q5a_2','q5a_3','q5a_4','q5b_1','q5b_2','q5b_3','q5b_4','q6_1','q6_2','q6_3','q6_4'])
            pdfReplacements[k] = '';
        const pdfHtml = replaceAll(readTemplate('evaluacion_competencias/evaluacion_competencias.html'), pdfReplacements);

        let formHtml = replaceAll(readTemplate('evaluacion_competencias/evaluacion_competencias_form.html'), {
            fecha, nombres, apellidos, cedula,
            f_cargo: formField('cargo', cargo, { placeholder: 'Cargo' }),
        });
        formHtml = applyFormBase(formHtml, {
            caller,
            prefillData: { nombres, apellidos, cedula, fecha, cargo, evaluacion_induccion_id: input.documento_id },
            cleanupUrls: [pdfUrl, formUrl, qrUrl],
        });

        return generateDocumentSet({ prefix, pdfHtml, formHtml });
    },

    evaluacionPostcosecha: async function evaluacionPostcosecha({ input, caller }) {
        /**
         * Hiring process — step 11 of 11 (last step). Generate a competency evaluation for Postcosecha area (SIG-TTHH-RG-12). Restricted to Talento Humano staff.
         * Requires: evaluacionCompetencias.
         * Pre-fills worker data. Questions on classification (diseases, pests, cut points, lira/tree), bonche, activities checklist, packing.
         * Results with observations and pass/fail. Three signatures: TTHH (caller), evaluado, jefe de area/supervisor.
         * Input: documento_id (string, required — id of the evaluacionCompetencias documento), cargo (string, optional).
         * Output: {pdf: string, qr: string, form: string}. Always show the QR using ![qr]({API_BASE}{qr}). The form link must be opened via the server URL.
         */
        await requireTalentoHumano(caller);
        const prev = await loadPrevDocument(input.documento_id);
        const { fecha } = dateInfo();
        const d = { ...prev, ...input };
        const nombres = d.nombres || '';
        const apellidos = d.apellidos || '';
        const cedula = d.cedula || '';
        const cargo = d.cargo || 'Trabajador Agrícola – POSTCOSECHA';
        const tthh = callerName(caller);
        const prefix = `postcosecha_${cedula || 'new'}_${Date.now()}`;
        const { pdfUrl, formUrl, qrUrl } = outputUrls(prefix);

        const pdfHtml = replaceAll(readTemplate('evaluacion_postcosecha/evaluacion_postcosecha.html'), {
            fecha, nombres: blank(nombres), apellidos: blank(apellidos), cedula: blank(cedula),
            cargo, tthh, experiencia: '', evaluador_jefe: '',
            novedades_tthh: '', observacion_jefe: '',
            res_aprobado: '', res_no_aprobado: '', r5: '', r7: '', r_empaque: '',
        });

        let formHtml = replaceAll(readTemplate('evaluacion_postcosecha/evaluacion_postcosecha_form.html'), {
            fecha, nombres, apellidos, cedula,
            f_cargo: formField('cargo', cargo, { placeholder: 'Cargo' }),
        });
        formHtml = applyFormBase(formHtml, {
            caller,
            prefillData: { nombres, apellidos, cedula, fecha, cargo, evaluacion_competencias_id: input.documento_id },
            cleanupUrls: [pdfUrl, formUrl, qrUrl],
        });

        return generateDocumentSet({ prefix, pdfHtml, formHtml });
    },

}
