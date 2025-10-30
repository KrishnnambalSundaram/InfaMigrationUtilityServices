Samples for Manual API Testing

This folder contains lightweight sample inputs you can use with the APIs.

Zips are not pre-generated. To test ZIP-based flows, zip the sample folders/files on your machine and pass the absolute zip path in the request.

Contents

- sql/
  - oracle_single.sql
  - redshift_single.sql
- batch/
  - run_oracle.bat
  - run_redshift.sh
- bodies/ (ready-to-send JSON bodies)
  - convert-unified-zip-snowflake.json
  - convert-unified-single-snowflake.json
  - convert-unified-zip-idmc.json
  - convert-unified-single-idmc.json
  - idmc-batch-zip.json
  - idmc-batch-single.json
  - download.json
  - websocket-notify.json
  - login.json

Tips

- Replace placeholder absolute paths like /absolute/path/to/*.zip in the JSON bodies with your real paths.
- For ZIP tests, create zips from the sql/ and batch/ files and use those zip paths.

