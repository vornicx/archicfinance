# Archic Finance

MVP personal y read-only:

**Revolut → Enable Banking → Archic Finance → ChatGPT**

## Configuración actual

1. Aplicación Enable Banking en producción restringida para cuentas propias.
2. Revolut enlazado mediante Account Information (AIS / read-only).
3. Proyecto desplegado en Vercel.
4. Variables privadas necesarias en Vercel:
   - `ENABLE_BANKING_PRIVATE_KEY`
   - `ENABLE_BANKING_SESSION_ID`
   - `CRON_SECRET`
5. El endpoint `/api/summary` devuelve un resumen financiero protegido por `CRON_SECRET`.
6. ChatGPT usa ese resumen para la revisión financiera semanal.

## Tratamiento de datos

- Solo lectura: no inicia pagos ni transferencias.
- No guarda usuario ni contraseña de Revolut.
- No mantiene una base de datos histórica de transacciones.
- Deduplica cuentas y movimientos repetidos antes de calcular métricas.
- Traslados internos identificables, como movimientos hacia Flexible Cash Funds, no se contabilizan como gasto ordinario.
- El saldo bancario puede no incluir productos de inversión o ahorro que Open Banking no exponga como cuenta bancaria.

## Seguridad

- La private key, session ID y `CRON_SECRET` viven únicamente en variables de entorno de Vercel.
- El endpoint financiero está protegido.
- La aplicación está restringida a las cuentas propias enlazadas en Enable Banking.
