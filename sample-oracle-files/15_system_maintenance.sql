-- System Maintenance and Utilities
-- Sample Oracle PL/SQL for system administration

CREATE OR REPLACE PROCEDURE daily_maintenance AS
    v_start_time DATE := SYSDATE;
    v_end_time DATE;
    v_processed_count NUMBER := 0;
    v_error_count NUMBER := 0;
BEGIN
    DBMS_OUTPUT.PUT_LINE('Starting daily maintenance routine...');
    DBMS_OUTPUT.PUT_LINE('Start time: ' || TO_CHAR(v_start_time, 'YYYY-MM-DD HH24:MI:SS'));
    
    -- Step 1: Clean up temporary data
    BEGIN
        DELETE FROM temp_processing_table
        WHERE created_date < SYSDATE - 1;
        
        v_processed_count := SQL%ROWCOUNT;
        DBMS_OUTPUT.PUT_LINE('Cleaned up ' || v_processed_count || ' temporary records');
    EXCEPTION
        WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
            DBMS_OUTPUT.PUT_LINE('Error in temp cleanup: ' || SQLERRM);
    END;
    
    -- Step 2: Update statistics
    BEGIN
        DBMS_STATS.GATHER_SCHEMA_STATS('USER', CASCADE => TRUE);
        DBMS_OUTPUT.PUT_LINE('Updated database statistics');
    EXCEPTION
        WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
            DBMS_OUTPUT.PUT_LINE('Error updating statistics: ' || SQLERRM);
    END;
    
    -- Step 3: Archive old logs
    BEGIN
        DELETE FROM application_log
        WHERE log_date < SYSDATE - 30;
        
        v_processed_count := v_processed_count + SQL%ROWCOUNT;
        DBMS_OUTPUT.PUT_LINE('Archived old application logs');
    EXCEPTION
        WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
            DBMS_OUTPUT.PUT_LINE('Error archiving logs: ' || SQLERRM);
    END;
    
    -- Step 4: Check disk space
    BEGIN
        DECLARE
            v_free_space NUMBER;
            v_total_space NUMBER;
        BEGIN
            SELECT 
                SUM(bytes) / 1024 / 1024 / 1024 as total_gb,
                SUM(bytes - NVL(bytes_free, 0)) / 1024 / 1024 / 1024 as used_gb
            INTO v_total_space, v_free_space
            FROM dba_data_files;
            
            IF v_free_space / v_total_space < 0.1 THEN
                DBMS_OUTPUT.PUT_LINE('WARNING: Low disk space detected!');
            END IF;
            
            DBMS_OUTPUT.PUT_LINE('Disk usage: ' || ROUND((v_total_space - v_free_space) / v_total_space * 100, 2) || '%');
        END;
    EXCEPTION
        WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
            DBMS_OUTPUT.PUT_LINE('Error checking disk space: ' || SQLERRM);
    END;
    
    -- Step 5: Validate data integrity
    BEGIN
        DECLARE
            v_orphaned_records NUMBER;
        BEGIN
            -- Check for orphaned order items
            SELECT COUNT(*) INTO v_orphaned_records
            FROM order_items oi
            WHERE NOT EXISTS (
                SELECT 1 FROM orders o WHERE o.order_id = oi.order_id
            );
            
            IF v_orphaned_records > 0 THEN
                DBMS_OUTPUT.PUT_LINE('WARNING: ' || v_orphaned_records || ' orphaned order items found');
            END IF;
            
            -- Check for orphaned inventory records
            SELECT COUNT(*) INTO v_orphaned_records
            FROM inventory i
            WHERE NOT EXISTS (
                SELECT 1 FROM products p WHERE p.product_id = i.product_id
            );
            
            IF v_orphaned_records > 0 THEN
                DBMS_OUTPUT.PUT_LINE('WARNING: ' || v_orphaned_records || ' orphaned inventory records found');
            END IF;
        END;
    EXCEPTION
        WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
            DBMS_OUTPUT.PUT_LINE('Error in data integrity check: ' || SQLERRM);
    END;
    
    v_end_time := SYSDATE;
    
    -- Log maintenance results
    INSERT INTO maintenance_log (
        maintenance_id,
        start_time,
        end_time,
        duration_minutes,
        processed_records,
        error_count,
        status
    ) VALUES (
        maintenance_seq.NEXTVAL,
        v_start_time,
        v_end_time,
        ROUND((v_end_time - v_start_time) * 24 * 60, 2),
        v_processed_count,
        v_error_count,
        CASE WHEN v_error_count = 0 THEN 'SUCCESS' ELSE 'WARNING' END
    );
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('Daily maintenance completed');
    DBMS_OUTPUT.PUT_LINE('End time: ' || TO_CHAR(v_end_time, 'YYYY-MM-DD HH24:MI:SS'));
    DBMS_OUTPUT.PUT_LINE('Duration: ' || ROUND((v_end_time - v_start_time) * 24 * 60, 2) || ' minutes');
    DBMS_OUTPUT.PUT_LINE('Processed records: ' || v_processed_count);
    DBMS_OUTPUT.PUT_LINE('Errors: ' || v_error_count);
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20044, 'Error in daily maintenance: ' || SQLERRM);
END daily_maintenance;

CREATE OR REPLACE PROCEDURE backup_critical_data AS
    v_backup_id NUMBER;
    v_table_count NUMBER := 0;
    v_record_count NUMBER := 0;
BEGIN
    DBMS_OUTPUT.PUT_LINE('Starting critical data backup...');
    
    -- Create backup session
    SELECT backup_seq.NEXTVAL INTO v_backup_id FROM DUAL;
    
    -- Backup customers table
    INSERT INTO customers_backup (
        backup_id,
        customer_id,
        customer_name,
        email,
        phone_number,
        address,
        created_date,
        backup_date
    )
    SELECT 
        v_backup_id,
        customer_id,
        customer_name,
        email,
        phone_number,
        address,
        created_date,
        SYSDATE
    FROM customers;
    
    v_table_count := v_table_count + 1;
    v_record_count := v_record_count + SQL%ROWCOUNT;
    
    -- Backup products table
    INSERT INTO products_backup (
        backup_id,
        product_id,
        product_name,
        description,
        price,
        category_id,
        created_date,
        backup_date
    )
    SELECT 
        v_backup_id,
        product_id,
        product_name,
        description,
        price,
        category_id,
        created_date,
        SYSDATE
    FROM products;
    
    v_table_count := v_table_count + 1;
    v_record_count := v_record_count + SQL%ROWCOUNT;
    
    -- Backup orders table
    INSERT INTO orders_backup (
        backup_id,
        order_id,
        customer_id,
        order_date,
        status,
        total_amount,
        backup_date
    )
    SELECT 
        v_backup_id,
        order_id,
        customer_id,
        order_date,
        status,
        total_amount,
        SYSDATE
    FROM orders;
    
    v_table_count := v_table_count + 1;
    v_record_count := v_record_count + SQL%ROWCOUNT;
    
    -- Log backup completion
    INSERT INTO backup_log (
        backup_id,
        backup_date,
        tables_backed_up,
        records_backed_up,
        status
    ) VALUES (
        v_backup_id,
        SYSDATE,
        v_table_count,
        v_record_count,
        'COMPLETED'
    );
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('Backup completed successfully');
    DBMS_OUTPUT.PUT_LINE('Backup ID: ' || v_backup_id);
    DBMS_OUTPUT.PUT_LINE('Tables backed up: ' || v_table_count);
    DBMS_OUTPUT.PUT_LINE('Records backed up: ' || v_record_count);
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20045, 'Error in backup process: ' || SQLERRM);
END backup_critical_data;

CREATE OR REPLACE FUNCTION get_system_status RETURN VARCHAR2 AS
    v_status VARCHAR2(20) := 'HEALTHY';
    v_issue_count NUMBER := 0;
BEGIN
    -- Check for critical issues
    DECLARE
        v_count NUMBER;
    BEGIN
        -- Check for locked accounts
        SELECT COUNT(*) INTO v_count
        FROM user_accounts
        WHERE login_attempts >= 5;
        
        IF v_count > 0 THEN
            v_issue_count := v_issue_count + 1;
        END IF;
        
        -- Check for failed jobs
        SELECT COUNT(*) INTO v_count
        FROM maintenance_log
        WHERE status = 'ERROR'
        AND start_time > SYSDATE - 1;
        
        IF v_count > 0 THEN
            v_issue_count := v_issue_count + 1;
        END IF;
        
        -- Check for low disk space
        SELECT COUNT(*) INTO v_count
        FROM dba_data_files
        WHERE bytes_free / bytes < 0.1;
        
        IF v_count > 0 THEN
            v_issue_count := v_issue_count + 1;
        END IF;
        
    END;
    
    -- Determine overall status
    IF v_issue_count = 0 THEN
        v_status := 'HEALTHY';
    ELSIF v_issue_count <= 2 THEN
        v_status := 'WARNING';
    ELSE
        v_status := 'CRITICAL';
    END IF;
    
    RETURN v_status;
    
    EXCEPTION
        WHEN OTHERS THEN
            RETURN 'UNKNOWN';
END get_system_status;
