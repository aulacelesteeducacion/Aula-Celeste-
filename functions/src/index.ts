import {onCall} from "firebase-functions/v2/https";

export const verificarBackend = onCall(() => {
  return {
    ok: true,
    mensaje: "Backend local funcionando",
  };
});