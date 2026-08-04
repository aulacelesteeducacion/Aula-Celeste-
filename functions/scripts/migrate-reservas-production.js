"use strict";

const fs = require("node:fs");
const path = require("node:path");

if (
  process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  throw new Error(
    "Hay variables del emulador activas. " +
    "Abre una terminal nueva para migrar producción."
  );
}

const {
  initializeApp,
  applicationDefault,
} = require("firebase-admin/app");

const {
  getFirestore,
  Timestamp,
} = require("firebase-admin/firestore");

initializeApp({
  credential: applicationDefault(),
  projectId: "aula-celeste",
});

const db = getFirestore();

const aplicarCambios =
  process.argv.includes("--apply");

function obtenerFechaChile() {
  const partes = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }
  ).formatToParts(new Date());

  const obtener = (tipo) =>
    partes.find(
      (parte) => parte.type === tipo
    )?.value ?? "";

  return [
    obtener("year"),
    obtener("month"),
    obtener("day"),
  ].join("-");
}

function fechaISOValida(valor) {
  if (
    typeof valor !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(valor)
  ) {
    return false;
  }

  const fecha = new Date(
    `${valor}T00:00:00Z`
  );

  return (
    !Number.isNaN(fecha.getTime()) &&
    fecha.toISOString().slice(0, 10) === valor
  );
}

function horaValida(valor) {
  return (
    typeof valor === "string" &&
    /^\d{2}:\d{2}$/.test(valor)
  );
}

function normalizarCelular(valor) {
  if (
    typeof valor !== "string" &&
    typeof valor !== "number"
  ) {
    return null;
  }

  const celular = String(valor)
    .trim()
    .replace(/[\s()+.-]/g, "")
    .replace(/^56/, "");

  return /^\d{8,9}$/.test(celular)
    ? celular
    : null;
}

function crearIdReserva(diaISO, hora) {
  return `${diaISO}_${hora.replace(":", "-")}`;
}

function obtenerCreatedAt(ts) {
  if (
    typeof ts === "number" &&
    Number.isFinite(ts) &&
    ts > 0
  ) {
    return Timestamp.fromMillis(ts);
  }

  return Timestamp.now();
}

function serializarValor(valor) {
  if (
    valor &&
    typeof valor.toDate === "function"
  ) {
    return valor.toDate().toISOString();
  }

  return valor;
}

function serializarDocumento(documento) {
  return {
    id: documento.id,
    data: Object.fromEntries(
      Object.entries(documento.data()).map(
        ([clave, valor]) => [
          clave,
          serializarValor(valor),
        ]
      )
    ),
  };
}

async function main() {
  const hoyChile = obtenerFechaChile();

  console.log(
    aplicarCambios
      ? "MODO: APLICAR MIGRACIÓN"
      : "MODO: SIMULACIÓN"
  );

  console.log("Fecha Chile:", hoyChile);

  const snapshot = await db
    .collection("reservas")
    .get();

  const documentos = snapshot.docs;

  /*
   * Se genera un respaldo local antes de realizar
   * cualquier modificación.
   */
  const directorioBackup =
    process.env.FIREBASE_BACKUP_DIR ||
    "C:\\FirebaseBackups";

  fs.mkdirSync(
    directorioBackup,
    {recursive: true}
  );

  const marcaTiempo = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const rutaBackup = path.join(
    directorioBackup,
    `reservas-${marcaTiempo}.json`
  );

  fs.writeFileSync(
    rutaBackup,
    JSON.stringify(
      documentos.map(serializarDocumento),
      null,
      2
    ),
    "utf8"
  );

  const validas = [];
  const invalidas = [];
  const pasadas = [];

  for (const documento of documentos) {
    const datos = documento.data();

    const diaISO = datos.diaISO;
    const hora = datos.hora;

    const nombre =
      typeof datos.nombre === "string"
        ? datos.nombre.trim()
        : "";

    const celular =
      normalizarCelular(datos.celular);

    const razones = [];

if (!fechaISOValida(diaISO)) {
  razones.push("diaISO inválido");
}

if (!horaValida(hora)) {
  razones.push("hora inválida");
}

if (
  nombre.length < 3 ||
  nombre.length > 100
) {
  razones.push("nombre inválido");
}

if (!celular) {
  razones.push("celular inválido");
}

if (razones.length > 0) {
  invalidas.push({
    id: documento.id,
    razones,
  });

  continue;
}

    if (diaISO < hoyChile) {
      pasadas.push(documento.id);
      continue;
    }

    validas.push({
      legacyId: documento.id,
      reservaId: crearIdReserva(
        diaISO,
        hora
      ),
      diaISO,
      hora,
      nombre,
      celular,
      createdAt: obtenerCreatedAt(
        datos.ts
      ),
    });
  }

  /*
   * Detecta dos documentos antiguos que ocupen
   * el mismo bloque horario.
   */
  const porReservaId = new Map();

  for (const reserva of validas) {
    const grupo =
      porReservaId.get(reserva.reservaId) ?? [];

    grupo.push(reserva);
    porReservaId.set(
      reserva.reservaId,
      grupo
    );
  }

  const duplicadas = [
    ...porReservaId.entries(),
  ].filter(([, grupo]) => grupo.length > 1);

  console.log("");
  console.log("Resumen:");
  console.log(
    "Documentos antiguos:",
    documentos.length
  );
  console.log(
    "Reservas futuras válidas:",
    validas.length
  );
  console.log(
    "Reservas pasadas omitidas:",
    pasadas.length
  );
  console.log(
    "Documentos inválidos:",
    invalidas.length
  );
  console.log(
    "Bloques duplicados:",
    duplicadas.length
  );
  console.log(
    "Respaldo:",
    rutaBackup
  );

  if (invalidas.length > 0) {
    console.log(
      "IDs inválidos:",
      invalidas
    );
  }

  if (duplicadas.length > 0) {
    console.log(
      "IDs de bloques duplicados:",
      duplicadas.map(
        ([reservaId]) => reservaId
      )
    );
  }

  if (!aplicarCambios) {
    console.log("");
    console.log(
      "Simulación terminada. " +
      "No se modificó Firestore."
    );

    console.log(
      "Para aplicar: agrega --apply"
    );

    return;
  }

  if (
    invalidas.length > 0 ||
    duplicadas.length > 0
  ) {
    throw new Error(
      "Migración cancelada: existen documentos " +
      "inválidos o bloques duplicados."
    );
  }

  let migradas = 0;
  let existentes = 0;

  for (const reserva of validas) {
    const disponibilidadRef = db
      .collection(
        "disponibilidad_publica"
      )
      .doc(reserva.reservaId);

    const privadaRef = db
      .collection(
        "reservas_privadas"
      )
      .doc(reserva.reservaId);

    const resultado = await db.runTransaction(
      async (transaction) => {
        const [
          disponibilidadSnapshot,
          privadaSnapshot,
        ] = await Promise.all([
          transaction.get(
            disponibilidadRef
          ),
          transaction.get(
            privadaRef
          ),
        ]);

        if (
          disponibilidadSnapshot.exists &&
          privadaSnapshot.exists
        ) {
          return "existente";
        }

        if (
          disponibilidadSnapshot.exists ||
          privadaSnapshot.exists
        ) {
          throw new Error(
            "Estado inconsistente para " +
            reserva.reservaId
          );
        }

        transaction.create(
          disponibilidadRef,
          {
            diaISO: reserva.diaISO,
            hora: reserva.hora,
            ocupado: true,
            createdAt:
              reserva.createdAt,
          }
        );

        transaction.create(
          privadaRef,
          {
            diaISO: reserva.diaISO,
            hora: reserva.hora,
            nombre: reserva.nombre,
            celular: reserva.celular,
            estado: "activa",
            ownerUid:
              "legacy-migration",
            createdAt:
              reserva.createdAt,
          }
        );

        return "migrada";
      }
    );

    if (resultado === "migrada") {
      migradas += 1;
    } else {
      existentes += 1;
    }

    console.log(
      `[${migradas + existentes}/` +
      `${validas.length}] ` +
      `${reserva.reservaId}: ${resultado}`
    );
  }

  console.log("");
  console.log("Migración terminada:");
  console.log("Migradas:", migradas);
  console.log(
    "Ya existentes:",
    existentes
  );

  console.log(
    "La colección antigua no fue eliminada."
  );
}

main().catch((error) => {
  console.error(
    "Error durante la migración:",
    error
  );

  process.exitCode = 1;
});