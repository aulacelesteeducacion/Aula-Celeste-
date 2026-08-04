"use strict";

if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error(
    "FIREBASE_AUTH_EMULATOR_HOST está definido. " +
    "Cierra esta terminal y abre una nueva antes de continuar."
  );
}

const {
  initializeApp,
  applicationDefault,
} = require("firebase-admin/app");

const {
  getAuth,
} = require("firebase-admin/auth");

initializeApp({
  credential: applicationDefault(),
  projectId: "aula-celeste",
});

async function main() {
  const email = process.argv[2]?.trim();

  if (!email) {
    throw new Error(
      "Debes indicar el correo del administrador."
    );
  }

  const auth = getAuth();
  const usuario = await auth.getUserByEmail(email);

  await auth.setCustomUserClaims(usuario.uid, {
    ...(usuario.customClaims ?? {}),
    admin: true,
  });

  const actualizado = await auth.getUser(usuario.uid);

  console.log("Administrador de producción configurado:");
  console.log({
    uid: actualizado.uid,
    email: actualizado.email,
    claims: actualizado.customClaims,
  });
}

main().catch((error) => {
  console.error(
    "No fue posible asignar el rol:",
    error
  );

  process.exitCode = 1;
});