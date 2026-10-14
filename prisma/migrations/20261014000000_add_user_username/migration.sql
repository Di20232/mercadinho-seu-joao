-- Login por nome de usuário: primeiro nome (minúsculo, sem acento) + código
-- aleatório de 4 dígitos, ex: "diego1239". A coluna nasce opcional para que as
-- contas existentes possam ser preenchidas, e só depois vira obrigatória.
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Preenche as contas existentes com a mesma regra de src/username.js.
DO $$
DECLARE
  u RECORD;
  base TEXT;
  candidate TEXT;
BEGIN
  FOR u IN SELECT id, name FROM "User" ORDER BY "createdAt" LOOP
    base := lower(translate(split_part(btrim(u.name), ' ', 1),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
      'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'));
    base := left(regexp_replace(base, '[^a-z0-9]', '', 'g'), 20);
    IF base = '' THEN
      base := 'usuario';
    END IF;
    LOOP
      candidate := base || (1000 + floor(random() * 9000))::int::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "User" WHERE "username" = candidate);
    END LOOP;
    UPDATE "User" SET "username" = candidate WHERE id = u.id;
  END LOOP;
END $$;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
