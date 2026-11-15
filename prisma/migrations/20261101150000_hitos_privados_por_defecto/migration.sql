-- Los hitos nuevos requieren publicación explícita; conserva la visibilidad de los existentes.
ALTER TABLE "hitos" ALTER COLUMN "visible_en_portal" SET DEFAULT false;
