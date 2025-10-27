-- Performance Optimization Procedures
-- Sample Oracle PL/SQL for performance tuning

CREATE OR REPLACE PROCEDURE optimize_database_performance AS
    v_sql_text VARCHAR2(4000);
    v_stats_updated NUMBER := 0;
BEGIN
    DBMS_OUTPUT.PUT_LINE('Starting database performance optimization...');
    
    -- Update table statistics
    DBMS_STATS.GATHER_TABLE_STATS('USER', 'CUSTOMERS');
    DBMS_STATS.GATHER_TABLE_STATS('USER', 'ORDERS');
    DBMS_STATS.GATHER_TABLE_STATS('USER', 'PRODUCTS');
    DBMS_STATS.GATHER_TABLE_STATS('USER', 'ORDER_ITEMS');
    DBMS_STATS.GATHER_TABLE_STATS('USER', 'INVENTORY');
    
    v_stats_updated := 5;
    
    -- Analyze and optimize slow queries
    FOR rec IN (
        SELECT sql_id, executions, elapsed_time, cpu_time
        FROM v$sql
        WHERE executions > 100
        AND elapsed_time / executions > 1000000 -- More than 1 second average
        ORDER BY elapsed_time DESC
        FETCH FIRST 10 ROWS ONLY
    ) LOOP
        DBMS_OUTPUT.PUT_LINE('Analyzing slow query: ' || rec.sql_id);
        
        -- Generate execution plan
        v_sql_text := 'SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(''' || rec.sql_id || '''))';
        
        -- Log performance issue
        INSERT INTO performance_log (
            log_id,
            sql_id,
            executions,
            avg_elapsed_time,
            avg_cpu_time,
            analysis_date
        ) VALUES (
            perf_seq.NEXTVAL,
            rec.sql_id,
            rec.executions,
            ROUND(rec.elapsed_time / rec.executions, 2),
            ROUND(rec.cpu_time / rec.executions, 2),
            SYSDATE
        );
    END LOOP;
    
    -- Clean up old performance logs
    DELETE FROM performance_log
    WHERE analysis_date < SYSDATE - 30;
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('Performance optimization completed. Updated ' || v_stats_updated || ' table statistics.');
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20031, 'Error in performance optimization: ' || SQLERRM);
END optimize_database_performance;

CREATE OR REPLACE PROCEDURE analyze_query_performance(
    p_sql_text IN VARCHAR2
) AS
    v_plan_table VARCHAR2(100) := 'PLAN_TABLE';
    v_explain_plan_id NUMBER;
BEGIN
    -- Clear previous plan
    DELETE FROM plan_table;
    
    -- Generate explain plan
    EXECUTE IMMEDIATE 'EXPLAIN PLAN FOR ' || p_sql_text;
    
    -- Analyze the plan
    FOR rec IN (
        SELECT 
            id,
            parent_id,
            operation,
            options,
            object_name,
            cost,
            cardinality,
            bytes
        FROM plan_table
        ORDER BY id
    ) LOOP
        DBMS_OUTPUT.PUT_LINE(
            LPAD(' ', (LEVEL - 1) * 2) || 
            rec.operation || ' ' || 
            NVL(rec.options, '') || ' ' ||
            NVL(rec.object_name, '') || 
            ' (Cost: ' || NVL(rec.cost, 0) || ')'
        );
        
        -- Check for performance issues
        IF rec.cost > 1000 THEN
            DBMS_OUTPUT.PUT_LINE('*** HIGH COST OPERATION DETECTED ***');
        END IF;
        
        IF rec.cardinality > 100000 THEN
            DBMS_OUTPUT.PUT_LINE('*** HIGH CARDINALITY DETECTED ***');
        END IF;
    END LOOP;
    
    EXCEPTION
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20032, 'Error analyzing query performance: ' || SQLERRM);
END analyze_query_performance;

CREATE OR REPLACE FUNCTION get_table_size(p_table_name IN VARCHAR2) RETURN NUMBER AS
    v_size_bytes NUMBER;
BEGIN
    SELECT SUM(bytes)
    INTO v_size_bytes
    FROM user_segments
    WHERE segment_name = UPPER(p_table_name);
    
    RETURN NVL(v_size_bytes, 0);
    
    EXCEPTION
        WHEN OTHERS THEN
            RETURN 0;
END get_table_size;

CREATE OR REPLACE PROCEDURE monitor_database_health AS
    v_table_count NUMBER;
    v_index_count NUMBER;
    v_total_size NUMBER := 0;
    v_unused_indexes NUMBER := 0;
    v_fragmented_tables NUMBER := 0;
    
BEGIN
    DBMS_OUTPUT.PUT_LINE('=== DATABASE HEALTH REPORT ===');
    
    -- Count tables
    SELECT COUNT(*) INTO v_table_count FROM user_tables;
    DBMS_OUTPUT.PUT_LINE('Total Tables: ' || v_table_count);
    
    -- Count indexes
    SELECT COUNT(*) INTO v_index_count FROM user_indexes;
    DBMS_OUTPUT.PUT_LINE('Total Indexes: ' || v_index_count);
    
    -- Calculate total database size
    SELECT SUM(bytes) INTO v_total_size FROM user_segments;
    DBMS_OUTPUT.PUT_LINE('Total Database Size: ' || ROUND(v_total_size / 1024 / 1024, 2) || ' MB');
    
    -- Check for unused indexes
    SELECT COUNT(*) INTO v_unused_indexes
    FROM user_indexes i
    WHERE NOT EXISTS (
        SELECT 1 FROM v$object_usage ou
        WHERE ou.index_name = i.index_name
        AND ou.used = 'YES'
    );
    
    IF v_unused_indexes > 0 THEN
        DBMS_OUTPUT.PUT_LINE('WARNING: ' || v_unused_indexes || ' potentially unused indexes found');
    END IF;
    
    -- Check for fragmented tables
    FOR rec IN (
        SELECT table_name, 
               ROUND((blocks * 8192) / 1024 / 1024, 2) as size_mb,
               ROUND((num_rows * avg_row_len) / 1024 / 1024, 2) as data_mb
        FROM user_tables
        WHERE num_rows > 0
        AND ROUND((blocks * 8192) / 1024 / 1024, 2) > ROUND((num_rows * avg_row_len) / 1024 / 1024, 2) * 2
    ) LOOP
        v_fragmented_tables := v_fragmented_tables + 1;
        DBMS_OUTPUT.PUT_LINE('FRAGMENTED TABLE: ' || rec.table_name || 
                           ' (Size: ' || rec.size_mb || ' MB, Data: ' || rec.data_mb || ' MB)');
    END LOOP;
    
    IF v_fragmented_tables > 0 THEN
        DBMS_OUTPUT.PUT_LINE('WARNING: ' || v_fragmented_tables || ' fragmented tables found');
    END IF;
    
    -- Log health metrics
    INSERT INTO database_health_log (
        check_id,
        check_date,
        table_count,
        index_count,
        total_size_mb,
        unused_indexes,
        fragmented_tables
    ) VALUES (
        health_seq.NEXTVAL,
        SYSDATE,
        v_table_count,
        v_index_count,
        ROUND(v_total_size / 1024 / 1024, 2),
        v_unused_indexes,
        v_fragmented_tables
    );
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('=== HEALTH CHECK COMPLETED ===');
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20033, 'Error in database health check: ' || SQLERRM);
END monitor_database_health;
