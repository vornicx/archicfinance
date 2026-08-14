# Archic Finance

MVP personal y read-only:

**Revolut → Enable Banking → resumen → email → ChatGPT**

## Configuración

1. Crea una aplicación en Enable Banking para uso personal/restringido.
2. Despliega este repo en Vercel.
3. Añade estas variables de entorno:
   - `ENABLE_BANKING_APP_ID`
   - `ENABLE_BANKING_PRIVATE_KEY`
   - `APP_URL`
   - `RESEND_API_KEY`
   - `REPORT_FROM`
   - `REPORT_TO`
   - `CRON_SECRET`
4. Deja `ENABLE_BANKING_SESSION_ID` vacío inicialmente.
5. Abre `https://TU-PROYECTO.vercel.app/api/connect` desde el iPhone donde tienes Revolut.
6. Autoriza el acceso de solo lectura.
7. El callback mostrará un `session_id`; guárdalo en Vercel como `ENABLE_BANKING_SESSION_ID` y redeploy.

## Seguridad

- Solo lectura (AIS).
- Sin pagos ni transferencias.
- No guarda usuario ni contraseña de Revolut.
- No almacena transacciones en una base de datos.
- Los secretos viven solo en variables de entorno de Vercel.

## Automatización

Vercel ejecuta `/api/report` cada domingo. El correo enviado usa el asunto `[Finance Weekly] ...`, para que ChatGPT pueda localizarlo y analizarlo automáticamente.
