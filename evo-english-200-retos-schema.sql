-- ============================================================================
-- EVO ENGLISH — EXPANSIÓN DEL MAPA A 200 RETOS (tabla "retos" en Supabase)
-- ============================================================================
-- Corre esto UNA VEZ en el SQL Editor de tu proyecto de Supabase. Es seguro
-- correrlo aunque ya tengas la tabla "alumnos" de antes: este script sólo
-- crea una tabla y funciones NUEVAS ("retos" / *_reto*), nunca toca
-- "alumnos" ni ninguna de sus funciones.
--
-- QUÉ ES ESTA TABLA
--   Guarda el CONTENIDO de cada uno de los 200 retos del Mapa de Aventuras
--   (10 zonas × 20 retos). No reemplaza al motor que ya corre en el
--   navegador (mapaAventuras.js) -- lo alimenta: la app sigue generando
--   la lección de 13 pasos (vocabulario, traducción EN↔ES, completar,
--   armar la oración, escucha/listening) EN VIVO a partir del "banco" de
--   8 palabras + 6 frases de cada reto -- igual que ya hace hoy con los
--   16 retos que vienen escritos directo en el código. Lo único que
--   cambia es DE DÓNDE sale ese banco: antes solo del código fuente,
--   ahora también (o en vez de) de aquí, para poder agregar/editar retos
--   sin tener que volver a publicar la app cada vez.
--
--   Por eso la columna "ejercicios" de abajo NO guarda 13 objetos ya
--   armados: guarda el banco {palabras:[...8], frases:[...6]} que el
--   motor expande. Generar los 13 pasos en vivo (en vez de guardarlos ya
--   fijos) es a propósito: así cada distractor de opción múltiple se
--   revuelve distinto cada vez que el alumno repite el reto, en vez de
--   ser siempre exactamente el mismo orden.
--
-- SEGURIDAD: mismo patrón que "alumnos" (RLS activado), pero el contenido
-- de los retos NO es información sensible (no hay contraseñas ni datos
-- de alumnos aquí), así que SÍ se permite una política pública de SOLO
-- LECTURA -- cualquiera con la Publishable Key puede leer los retos
-- (hace falta para que la app funcione), pero sólo las funciones (RPC)
-- de abajo, protegidas con la contraseña de admin, pueden crear/editar/
-- borrar un reto.
-- ============================================================================

set search_path = public, extensions, pg_catalog;

-- ----------------------------------------------------------------------------
-- 1) TABLA "retos"
-- ----------------------------------------------------------------------------
create table if not exists public.retos (
  reto_id      int primary key check (reto_id between 1 and 200),
  zona_id      int not null check (zona_id between 1 and 10),
  titulo       text not null,
  descripcion  text,
  -- URLs de audio grabado de verdad (opcional). Hoy la app no las usa
  -- todavía: el paso de "escucha" reproduce la frase con voz sintética
  -- (Web Speech API, función say() ya existente) a partir de "ejercicios.
  -- frases[].en", así que un reto SIN audios_urls funciona igual de bien.
  -- Este campo queda listo para cuando haya grabaciones reales con voz
  -- humana: la app las preferiría sobre la voz sintética.
  audios_urls  jsonb not null default '[]'::jsonb,
  -- {palabras:[{en,es} x8], frases:[{en,es} x6]} -- ver nota arriba.
  ejercicios   jsonb not null,
  creado_en    timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  -- Cada zona tiene como máximo 20 retos, y el reto_id de cada uno debe
  -- caer dentro del rango de su propia zona (zona 1 = retos 1-20, zona 2
  -- = retos 21-40, etc.) -- esta regla evita el error de capturar, por
  -- ejemplo, un reto de la Zona 3 con reto_id 25 (que en realidad le
  -- tocaría a la Zona 2) sin darse cuenta.
  constraint retos_reto_id_en_su_zona check (reto_id between (zona_id - 1) * 20 + 1 and zona_id * 20)
);

comment on table public.retos is 'Contenido de los 200 retos del Mapa de Aventuras (10 zonas x 20 retos). Ver evo-english-200-retos-schema.sql';

-- Mantiene "actualizado_en" al día solo; no toca "creado_en".
create or replace function public.retos_set_actualizado_en()
returns trigger language plpgsql as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;
drop trigger if exists trg_retos_actualizado_en on public.retos;
create trigger trg_retos_actualizado_en
  before update on public.retos
  for each row execute function public.retos_set_actualizado_en();

-- ----------------------------------------------------------------------------
-- 2) RLS: lectura pública (el contenido de los retos no es secreto),
--    escritura SOLO a través de las funciones RPC de la sección 3.
-- ----------------------------------------------------------------------------
alter table public.retos enable row level security;

drop policy if exists "retos: lectura publica" on public.retos;
create policy "retos: lectura publica"
  on public.retos for select
  to anon, authenticated
  using (true);
-- OJO: a propósito NO se crea ninguna política de insert/update/delete,
-- así que la Publishable Key no puede escribir la tabla directo (ni con
-- "supabase.from('retos').insert(...)" desde la consola del navegador) --
-- sólo puede hacerlo a través de las funciones admin_* de abajo.

-- ----------------------------------------------------------------------------
-- 3) FUNCIONES
-- ----------------------------------------------------------------------------

-- 3.1) LISTAR (la usa la app para cargar los retos reales al arrancar;
--      también sirve de respaldo si en el futuro se quita la política de
--      lectura pública de arriba y se centraliza todo por RPC).
create or replace function public.listar_retos()
returns table (
  reto_id int, zona_id int, titulo text, descripcion text,
  audios_urls jsonb, ejercicios jsonb
)
language sql stable security definer set search_path = public, extensions, pg_catalog
as $$
  select r.reto_id, r.zona_id, r.titulo, r.descripcion, r.audios_urls, r.ejercicios
  from public.retos r
  order by r.reto_id;
$$;
grant execute on function public.listar_retos() to anon, authenticated;

-- 3.2) CARGAR/ACTUALIZAR UN RETO (upsert: lo crea si no existe, lo
--      actualiza si ya existe con ese reto_id -- así este mismo script se
--      puede volver a correr para corregir un reto sin duplicarlo).
create or replace function public.admin_guardar_reto(
  p_admin_password text, p_zona_id int, p_reto_id int,
  p_titulo text, p_descripcion text, p_audios_urls jsonb, p_ejercicios jsonb
)
returns json
language plpgsql security definer set search_path = public, extensions, pg_catalog
as $$
begin
  if p_admin_password is distinct from 'evo123' then
    raise exception 'No autorizado';
  end if;
  insert into public.retos (reto_id, zona_id, titulo, descripcion, audios_urls, ejercicios)
  values (p_reto_id, p_zona_id, trim(p_titulo), p_descripcion, coalesce(p_audios_urls, '[]'::jsonb), p_ejercicios)
  on conflict (reto_id) do update
    set zona_id = excluded.zona_id, titulo = excluded.titulo, descripcion = excluded.descripcion,
        audios_urls = excluded.audios_urls, ejercicios = excluded.ejercicios;
  return json_build_object('ok', true);
end;
$$;
grant execute on function public.admin_guardar_reto(text, int, int, text, text, jsonb, jsonb) to anon, authenticated;

-- 3.3) CARGA MASIVA — pega un arreglo JSON con varios retos y los guarda
--      todos en una sola llamada (esto es lo que usa el script de carga,
--      ver evo-english-cargar-retos.py o el bloque de ejemplo más abajo).
--      Formato de p_retos (un arreglo, uno por reto):
--        [{"zona_id":1,"reto_id":5,"titulo":"...", "descripcion":"...",
--          "audios_urls":[], "ejercicios":{"palabras":[{"en":"...","es":"..."},...8],
--          "frases":[{"en":"...","es":"..."},...6]}}, ...]
create or replace function public.admin_cargar_retos(p_admin_password text, p_retos jsonb)
returns json
language plpgsql security definer set search_path = public, extensions, pg_catalog
as $$
declare
  v_item jsonb;
  v_cuenta int := 0;
begin
  if p_admin_password is distinct from 'evo123' then
    raise exception 'No autorizado';
  end if;
  if jsonb_typeof(p_retos) is distinct from 'array' then
    raise exception 'p_retos debe ser un arreglo JSON de retos';
  end if;
  for v_item in select * from jsonb_array_elements(p_retos) loop
    insert into public.retos (reto_id, zona_id, titulo, descripcion, audios_urls, ejercicios)
    values (
      (v_item->>'reto_id')::int,
      (v_item->>'zona_id')::int,
      trim(v_item->>'titulo'),
      v_item->>'descripcion',
      coalesce(v_item->'audios_urls', '[]'::jsonb),
      v_item->'ejercicios'
    )
    on conflict (reto_id) do update
      set zona_id = excluded.zona_id, titulo = excluded.titulo, descripcion = excluded.descripcion,
          audios_urls = excluded.audios_urls, ejercicios = excluded.ejercicios;
    v_cuenta := v_cuenta + 1;
  end loop;
  return json_build_object('ok', true, 'cargados', v_cuenta);
end;
$$;
grant execute on function public.admin_cargar_retos(text, jsonb) to anon, authenticated;

-- 3.4) BORRAR un reto (por si se capturó algo mal y hay que quitarlo).
create or replace function public.admin_eliminar_reto(p_admin_password text, p_reto_id int)
returns json
language plpgsql security definer set search_path = public, extensions, pg_catalog
as $$
begin
  if p_admin_password is distinct from 'evo123' then
    raise exception 'No autorizado';
  end if;
  delete from public.retos where reto_id = p_reto_id;
  return json_build_object('ok', found);
end;
$$;
grant execute on function public.admin_eliminar_reto(text, int) to anon, authenticated;

-- ============================================================================
-- LISTO. A partir de aquí ya existe la tabla "retos" (vacía) y las 4
-- funciones para leerla/llenarla. Nada de esto cambia el Mapa de
-- Aventuras todavía -- necesita además el cambio en mapaAventuras.js
-- (RetosRepository + AventuraEngine) que se publica junto con este script.
--
-- EJEMPLO para cargar un reto de prueba a mano, desde el SQL Editor:
--
-- select admin_cargar_retos('evo123', '[
--   {"zona_id":1, "reto_id":5, "titulo":"Pedir ayuda", "descripcion":"Frases básicas para pedir ayuda.",
--    "audios_urls":[],
--    "ejercicios":{
--      "palabras":[{"en":"help","es":"ayuda"},{"en":"please","es":"por favor"},{"en":"sorry","es":"perdón"},
--                   {"en":"excuse me","es":"disculpe"},{"en":"thanks","es":"gracias"},{"en":"problem","es":"problema"},
--                   {"en":"understand","es":"entender"},{"en":"repeat","es":"repetir"}],
--      "frases":[{"en":"Can you help me, please?","es":"¿Me puede ayudar, por favor?"},
--                {"en":"Excuse me, I have a problem.","es":"Disculpe, tengo un problema."},
--                {"en":"I do not understand.","es":"No entiendo."},
--                {"en":"Sorry, can you repeat that?","es":"Perdón, ¿puede repetirlo?"},
--                {"en":"Thank you so much.","es":"Muchas gracias."},
--                {"en":"Is there a problem?","es":"¿Hay algún problema?"}]
--    }}
-- ]'::jsonb);
-- ============================================================================
