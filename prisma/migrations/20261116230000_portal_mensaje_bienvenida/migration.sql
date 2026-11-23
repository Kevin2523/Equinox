-- Agrega el campo opcional de mensaje de bienvenida para el portal del cliente.
ALTER TABLE "organizaciones"
ADD COLUMN "portal_mensaje_bienvenida" TEXT;
