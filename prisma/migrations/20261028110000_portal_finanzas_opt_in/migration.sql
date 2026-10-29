-- La política de visibilidad financiera comienza desactivada para toda organización.
ALTER TABLE "organizaciones"
ADD COLUMN "portal_mostrar_finanzas" BOOLEAN NOT NULL DEFAULT false;
