"use strict";

// Este script apunta exclusivamente al Authentication Emulator local.
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "aula-celeste";

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

initializeApp({
  projectId: "aula-celeste",
});

async function main() {
  const email = process.argv[2]?.trim();

  if (!email) {
    throw new Error(
      "Debes indicar el correo. Ejemplo: node set-admin-local.js admin@correo.cl"
    );
  }

  const auth = getAuth();
  const usuario = await auth.getUserByEmail(email);

  await auth.setCustomUserClaims(usuario.uid, {
    ...(usuario.customClaims ?? {}),
    admin: true,
  });

  const actualizado = await auth.getUser(usuario.uid);

  console.log("Rol administrativo asignado:");
  console.log({
    uid: actualizado.uid,
    email: actualizado.email,
    claims: actualizado.customClaims,
  });
}

main().catch((error) => {
  console.error("No fue posible asignar el rol:", error);
  process.exitCode = 1;
});