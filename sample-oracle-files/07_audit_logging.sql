-- Audit and Logging Procedures
-- Sample Oracle PL/SQL for audit trails

CREATE OR REPLACE PROCEDURE log_customer_change(
    p_customer_id IN NUMBER,
    p_field_name IN VARCHAR2,
    p_old_value IN VARCHAR2,
    p_new_value IN VARCHAR2,
    p_user_id IN VARCHAR2
) AS
BEGIN
    INSERT INTO customer_audit_log (
        audit_id,
        customer_id,
        field_name,
        old_value,
        new_value,
        changed_by,
        change_date
    ) VALUES (
        audit_seq.NEXTVAL,
        p_customer_id,
        p_field_name,
        p_old_value,
        p_new_value,
        p_user_id,
        SYSDATE
    );
    
    COMMIT;
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20022, 'Error logging customer change: ' || SQLERRM);
END log_customer_change;

CREATE OR REPLACE PROCEDURE log_order_activity(
    p_order_id IN NUMBER,
    p_activity_type IN VARCHAR2,
    p_description IN VARCHAR2,
    p_user_id IN VARCHAR2
) AS
BEGIN
    INSERT INTO order_activity_log (
        log_id,
        order_id,
        activity_type,
        description,
        user_id,
        activity_date
    ) VALUES (
        activity_seq.NEXTVAL,
        p_order_id,
        p_activity_type,
        p_description,
        p_user_id,
        SYSDATE
    );
    
    COMMIT;
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20023, 'Error logging order activity: ' || SQLERRM);
END log_order_activity;

CREATE OR REPLACE FUNCTION get_audit_trail(
    p_table_name IN VARCHAR2,
    p_record_id IN NUMBER,
    p_days_back IN NUMBER DEFAULT 30
) RETURN SYS_REFCURSOR AS
    v_cursor SYS_REFCURSOR;
BEGIN
    OPEN v_cursor FOR
        SELECT 
            audit_id,
            field_name,
            old_value,
            new_value,
            changed_by,
            change_date
        FROM customer_audit_log
        WHERE customer_id = p_record_id
        AND change_date >= SYSDATE - p_days_back
        ORDER BY change_date DESC;
    
    RETURN v_cursor;
    
    EXCEPTION
        WHEN OTHERS THEN
            RETURN NULL;
END get_audit_trail;

CREATE OR REPLACE PROCEDURE archive_old_audit_logs(
    p_retention_days IN NUMBER DEFAULT 365
) AS
    v_deleted_count NUMBER := 0;
BEGIN
    -- Delete old audit logs
    DELETE FROM customer_audit_log
    WHERE change_date < SYSDATE - p_retention_days;
    
    v_deleted_count := SQL%ROWCOUNT;
    
    -- Delete old activity logs
    DELETE FROM order_activity_log
    WHERE activity_date < SYSDATE - p_retention_days;
    
    v_deleted_count := v_deleted_count + SQL%ROWCOUNT;
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('Archived ' || v_deleted_count || ' old log records');
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20024, 'Error archiving audit logs: ' || SQLERRM);
END archive_old_audit_logs;
