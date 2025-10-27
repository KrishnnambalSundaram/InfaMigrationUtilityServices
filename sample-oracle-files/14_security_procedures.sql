-- Security and Access Control Procedures
-- Sample Oracle PL/SQL for security management

CREATE OR REPLACE PROCEDURE create_user_account(
    p_username IN VARCHAR2,
    p_password IN VARCHAR2,
    p_email IN VARCHAR2,
    p_role IN VARCHAR2 DEFAULT 'USER'
) AS
    v_user_id NUMBER;
    v_encrypted_password VARCHAR2(100);
    v_salt VARCHAR2(50);
BEGIN
    -- Validate inputs
    IF p_username IS NULL OR LENGTH(p_username) < 3 THEN
        RAISE_APPLICATION_ERROR(-20034, 'Username must be at least 3 characters');
    END IF;
    
    IF p_password IS NULL OR LENGTH(p_password) < 8 THEN
        RAISE_APPLICATION_ERROR(-20035, 'Password must be at least 8 characters');
    END IF;
    
    IF NOT REGEXP_LIKE(p_email, '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') THEN
        RAISE_APPLICATION_ERROR(-20036, 'Invalid email format');
    END IF;
    
    -- Generate salt
    v_salt := DBMS_RANDOM.STRING('A', 16);
    
    -- Encrypt password (simplified - in real implementation use proper hashing)
    v_encrypted_password := UPPER(RAWTOHEX(DBMS_CRYPTO.HASH(
        UTL_RAW.CAST_TO_RAW(p_password || v_salt),
        DBMS_CRYPTO.HASH_SH1
    )));
    
    -- Create user account
    SELECT user_seq.NEXTVAL INTO v_user_id FROM DUAL;
    
    INSERT INTO user_accounts (
        user_id,
        username,
        password_hash,
        salt,
        email,
        role,
        created_date,
        last_login,
        is_active
    ) VALUES (
        v_user_id,
        LOWER(p_username),
        v_encrypted_password,
        v_salt,
        LOWER(p_email),
        p_role,
        SYSDATE,
        NULL,
        'Y'
    );
    
    -- Log account creation
    INSERT INTO security_log (
        log_id,
        user_id,
        action_type,
        description,
        ip_address,
        log_date
    ) VALUES (
        security_seq.NEXTVAL,
        v_user_id,
        'ACCOUNT_CREATED',
        'New user account created',
        SYS_CONTEXT('USERENV', 'IP_ADDRESS'),
        SYSDATE
    );
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('User account created successfully for: ' || p_username);
    
    EXCEPTION
        WHEN DUP_VAL_ON_INDEX THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20037, 'Username or email already exists');
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20038, 'Error creating user account: ' || SQLERRM);
END create_user_account;

CREATE OR REPLACE FUNCTION authenticate_user(
    p_username IN VARCHAR2,
    p_password IN VARCHAR2
) RETURN NUMBER AS
    v_user_id NUMBER;
    v_stored_hash VARCHAR2(100);
    v_salt VARCHAR2(50);
    v_input_hash VARCHAR2(100);
    v_login_attempts NUMBER;
BEGIN
    -- Get user information
    SELECT user_id, password_hash, salt, login_attempts
    INTO v_user_id, v_stored_hash, v_salt, v_login_attempts
    FROM user_accounts
    WHERE username = LOWER(p_username)
    AND is_active = 'Y';
    
    -- Check if account is locked
    IF v_login_attempts >= 5 THEN
        RAISE_APPLICATION_ERROR(-20039, 'Account is locked due to too many failed attempts');
    END IF;
    
    -- Calculate input hash
    v_input_hash := UPPER(RAWTOHEX(DBMS_CRYPTO.HASH(
        UTL_RAW.CAST_TO_RAW(p_password || v_salt),
        DBMS_CRYPTO.HASH_SH1
    )));
    
    -- Verify password
    IF v_input_hash = v_stored_hash THEN
        -- Reset login attempts
        UPDATE user_accounts
        SET login_attempts = 0,
            last_login = SYSDATE
        WHERE user_id = v_user_id;
        
        -- Log successful login
        INSERT INTO security_log (
            log_id,
            user_id,
            action_type,
            description,
            ip_address,
            log_date
        ) VALUES (
            security_seq.NEXTVAL,
            v_user_id,
            'LOGIN_SUCCESS',
            'User logged in successfully',
            SYS_CONTEXT('USERENV', 'IP_ADDRESS'),
            SYSDATE
        );
        
        COMMIT;
        
        RETURN v_user_id;
    ELSE
        -- Increment failed attempts
        UPDATE user_accounts
        SET login_attempts = login_attempts + 1
        WHERE user_id = v_user_id;
        
        -- Log failed login
        INSERT INTO security_log (
            log_id,
            user_id,
            action_type,
            description,
            ip_address,
            log_date
        ) VALUES (
            security_seq.NEXTVAL,
            v_user_id,
            'LOGIN_FAILED',
            'Failed login attempt',
            SYS_CONTEXT('USERENV', 'IP_ADDRESS'),
            SYSDATE
        );
        
        COMMIT;
        
        RAISE_APPLICATION_ERROR(-20040, 'Invalid username or password');
    END IF;
    
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20040, 'Invalid username or password');
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20041, 'Authentication error: ' || SQLERRM);
END authenticate_user;

CREATE OR REPLACE PROCEDURE audit_data_access(
    p_user_id IN NUMBER,
    p_table_name IN VARCHAR2,
    p_operation IN VARCHAR2,
    p_record_id IN NUMBER DEFAULT NULL
) AS
BEGIN
    INSERT INTO data_access_log (
        access_id,
        user_id,
        table_name,
        operation,
        record_id,
        access_date,
        ip_address
    ) VALUES (
        access_seq.NEXTVAL,
        p_user_id,
        p_table_name,
        p_operation,
        p_record_id,
        SYSDATE,
        SYS_CONTEXT('USERENV', 'IP_ADDRESS')
    );
    
    COMMIT;
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20042, 'Error logging data access: ' || SQLERRM);
END audit_data_access;

CREATE OR REPLACE PROCEDURE cleanup_security_logs(
    p_retention_days IN NUMBER DEFAULT 90
) AS
    v_deleted_count NUMBER := 0;
BEGIN
    -- Clean up old security logs
    DELETE FROM security_log
    WHERE log_date < SYSDATE - p_retention_days;
    
    v_deleted_count := SQL%ROWCOUNT;
    
    -- Clean up old data access logs
    DELETE FROM data_access_log
    WHERE access_date < SYSDATE - p_retention_days;
    
    v_deleted_count := v_deleted_count + SQL%ROWCOUNT;
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('Cleaned up ' || v_deleted_count || ' old security log records');
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20043, 'Error cleaning up security logs: ' || SQLERRM);
END cleanup_security_logs;
