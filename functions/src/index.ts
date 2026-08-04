import {initializeApp} from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";
import {
  HttpsError,
  onCall,
} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

initializeApp();

const db = getFirestore();

const REGION = "southamerica-west1";
const ZONA_HORARIA = "America/Santiago";

const HORARIOS: Readonly<Record<number, readonly string[]>> = {
  1: ["20:00", "21:00", "22:00"],
  2: ["18:00", "19:00", "20:00"],
  3: ["18:00", "19:00", "20:00"],
  4: ["20:00", "21:00", "22:00"],
  5: [
    "15:00",
    "16:00",
    "17:00",
    "18:00",
    "19:00",
    "20:00",
    "21:00",
    "22:00",
  ],
  6: [
    "11:00",
    "12:00",
    "13:00",
    "14:00",
    "15:00",
    "16:00",
    "17:00",
    "18:00",
    "19:00",
    "20:00",
    "21:00",
    "22:00",
  ],
};

interface CrearReservaData {
  diaISO?: unknown;
  hora?: unknown;
  nombre?: unknown;
  celular?: unknown;
}

interface CancelarReservaData {
  reservaId?: unknown;
}

function normalizarNombre(valor: unknown): string {
  if (typeof valor !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "El nombre debe ser texto.",
    );
  }

  const nombre = valor
    .trim()
    .replace(/\s+/g, " ");

  if (nombre.length < 3 || nombre.length > 100) {
    throw new HttpsError(
      "invalid-argument",
      "El nombre debe contener entre 3 y 100 caracteres.",
    );
  }

  if (/[\u0000-\u001F\u007F]/.test(nombre)) {
    throw new HttpsError(
      "invalid-argument",
      "El nombre contiene caracteres no permitidos.",
    );
  }

  return nombre;
}

function normalizarCelular(valor: unknown): string {
  if (typeof valor !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "El celular debe ser texto.",
    );
  }

  const celular = valor
    .trim()
    .replace(/[\s()-]/g, "")
    .replace(/^\+56/, "")
    .replace(/^56/, "");

  if (!/^\d{8,9}$/.test(celular)) {
    throw new HttpsError(
      "invalid-argument",
      "El número de celular no es válido.",
    );
  }

  return celular;
}

function validarFechaISO(valor: unknown): string {
  if (
    typeof valor !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(valor)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "La fecha no es válida.",
    );
  }

  const fecha = new Date(`${valor}T00:00:00Z`);

  if (
    Number.isNaN(fecha.getTime()) ||
    fecha.toISOString().slice(0, 10) !== valor
  ) {
    throw new HttpsError(
      "invalid-argument",
      "La fecha no existe.",
    );
  }

  return valor;
}

function validarHora(valor: unknown): string {
  if (
    typeof valor !== "string" ||
    !/^\d{2}:\d{2}$/.test(valor)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "La hora no es válida.",
    );
  }

  return valor;
}

function obtenerParte(
  partes: Intl.DateTimeFormatPart[],
  tipo: string,
): string {
  return partes.find((parte) => parte.type === tipo)?.value ?? "";
}

function obtenerAhoraChile(): {
  fechaISO: string;
  hora: string;
} {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const year = obtenerParte(partes, "year");
  const month = obtenerParte(partes, "month");
  const day = obtenerParte(partes, "day");
  const hour = obtenerParte(partes, "hour");
  const minute = obtenerParte(partes, "minute");

  return {
    fechaISO: `${year}-${month}-${day}`,
    hora: `${hour}:${minute}`,
  };
}

function validarBloquePermitido(
  diaISO: string,
  hora: string,
): void {
  const fechaBloque = new Date(`${diaISO}T00:00:00Z`);
  const diaSemana = fechaBloque.getUTCDay();
  const horasPermitidas = HORARIOS[diaSemana];

  if (!horasPermitidas?.includes(hora)) {
    throw new HttpsError(
      "invalid-argument",
      "El horario seleccionado no está disponible.",
    );
  }

  const ahoraChile = obtenerAhoraChile();
  const bloqueComparable = `${diaISO}T${hora}`;
  const ahoraComparable =
    `${ahoraChile.fechaISO}T${ahoraChile.hora}`;

  if (bloqueComparable <= ahoraComparable) {
    throw new HttpsError(
      "failed-precondition",
      "No es posible reservar un horario pasado.",
    );
  }

  const fechaActual = new Date(
    `${ahoraChile.fechaISO}T00:00:00Z`,
  );

  const diaActual = fechaActual.getUTCDay();
  const diferenciaLunes =
    diaActual === 0 ? -6 : 1 - diaActual;

  const lunesActual = new Date(fechaActual);

  lunesActual.setUTCDate(
    fechaActual.getUTCDate() + diferenciaLunes,
  );

  const limite = new Date(lunesActual);
  limite.setUTCDate(lunesActual.getUTCDate() + 14);

  if (
    fechaBloque < lunesActual ||
    fechaBloque >= limite
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Solo se puede reservar esta semana o la próxima.",
    );
  }
}

function crearIdReserva(
  diaISO: string,
  hora: string,
): string {
  return `${diaISO}_${hora.replace(":", "-")}`;
}

export const crearReserva = onCall(
  {
    region: REGION,
    timeoutSeconds: 15,
    maxInstances: 10,
    enforceAppCheck: false,
  },
  async (request) => {
    const data =
      (request.data ?? {}) as CrearReservaData;

    const diaISO = validarFechaISO(data.diaISO);
    const hora = validarHora(data.hora);
    const nombre = normalizarNombre(data.nombre);
    const celular = normalizarCelular(data.celular);

    validarBloquePermitido(diaISO, hora);

    const reservaId = crearIdReserva(diaISO, hora);

    const disponibilidadRef = db
      .collection("disponibilidad_publica")
      .doc(reservaId);

    const reservaRef = db
      .collection("reservas_privadas")
      .doc(reservaId);

    try {
      await db.runTransaction(async (transaction) => {
        const [
          disponibilidadSnapshot,
          reservaSnapshot,
        ] = await Promise.all([
          transaction.get(disponibilidadRef),
          transaction.get(reservaRef),
        ]);

        if (
          disponibilidadSnapshot.exists ||
          reservaSnapshot.exists
        ) {
          throw new HttpsError(
            "already-exists",
            "Ese horario ya fue reservado.",
          );
        }

        transaction.create(disponibilidadRef, {
          diaISO,
          hora,
          ocupado: true,
          createdAt: FieldValue.serverTimestamp(),
        });

        transaction.create(reservaRef, {
          diaISO,
          hora,
          nombre,
          celular,
          estado: "activa",
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      logger.info("Reserva creada", {
        reservaId,
        diaISO,
        hora,
      });

      return {
        ok: true,
        reservaId,
      };
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      logger.error("Error creando reserva", error);

      throw new HttpsError(
        "internal",
        "No fue posible crear la reserva.",
      );
    }
  },
);

export const cancelarReserva = onCall(
  {
    region: REGION,
    timeoutSeconds: 15,
    maxInstances: 10,
    enforceAppCheck: false,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesión para cancelar una reserva.",
      );
    }

    const data =
      (request.data ?? {}) as CancelarReservaData;

    if (
      typeof data.reservaId !== "string" ||
      !/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/.test(
        data.reservaId,
      )
    ) {
      throw new HttpsError(
        "invalid-argument",
        "El identificador de la reserva no es válido.",
      );
    }

    const reservaId = data.reservaId;

    const disponibilidadRef = db
      .collection("disponibilidad_publica")
      .doc(reservaId);

    const reservaRef = db
      .collection("reservas_privadas")
      .doc(reservaId);

    const auditoriaRef = db
      .collection("auditoria_cancelaciones")
      .doc();

    try {
      await db.runTransaction(async (transaction) => {
        const reservaSnapshot =
          await transaction.get(reservaRef);

        if (!reservaSnapshot.exists) {
          throw new HttpsError(
            "not-found",
            "La reserva no existe o ya fue cancelada.",
          );
        }

        const reserva = reservaSnapshot.data() ?? {};

        transaction.set(auditoriaRef, {
          ...reserva,
          reservaId,
          canceladaAt: FieldValue.serverTimestamp(),
          canceladaPorUid: request.auth?.uid ?? null,
          canceladaPorEmail:
            request.auth?.token.email ?? null,
        });

        transaction.delete(reservaRef);
        transaction.delete(disponibilidadRef);
      });

      logger.info("Reserva cancelada", {
        reservaId,
        uid: request.auth.uid,
      });

      return {
        ok: true,
        reservaId,
      };
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      logger.error("Error cancelando reserva", error);

      throw new HttpsError(
        "internal",
        "No fue posible cancelar la reserva.",
      );
    }
  },
);