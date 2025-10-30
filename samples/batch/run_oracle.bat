@echo off
REM Example Oracle batch invoking SQL*Loader and SQL*Plus
SET DATAFILE=C:\data\orders_2024.csv
SET CTLFILE=C:\etl\load_orders.ctl
SET SQLFILE=C:\etl\post_load_checks.sql

sqlldr userid=user/password@ORCL control="%CTLFILE%" data="%DATAFILE%" log=C:\logs\load_orders.log bad=C:\logs\load_orders.bad
sqlplus -L user/password@ORCL @%SQLFILE%
EXIT

