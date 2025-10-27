-- Data Validation and Utility Functions
-- Sample Oracle PL/SQL for data validation

CREATE OR REPLACE FUNCTION validate_email(p_email IN VARCHAR2) RETURN BOOLEAN AS
    v_pattern VARCHAR2(100) := '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
BEGIN
    IF p_email IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Simple email validation using REGEXP_LIKE
    IF REGEXP_LIKE(p_email, v_pattern) THEN
        RETURN TRUE;
    ELSE
        RETURN FALSE;
    END IF;
    
    EXCEPTION
        WHEN OTHERS THEN
            RETURN FALSE;
END validate_email;

CREATE OR REPLACE FUNCTION validate_phone(p_phone IN VARCHAR2) RETURN BOOLEAN AS
BEGIN
    IF p_phone IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Remove all non-digit characters
    DECLARE
        v_clean_phone VARCHAR2(20);
    BEGIN
        v_clean_phone := REGEXP_REPLACE(p_phone, '[^0-9]', '');
        
        -- Check if phone number has 10 digits (US format)
        IF LENGTH(v_clean_phone) = 10 THEN
            RETURN TRUE;
        ELSE
            RETURN FALSE;
        END IF;
    END;
    
    EXCEPTION
        WHEN OTHERS THEN
            RETURN FALSE;
END validate_phone;

CREATE OR REPLACE PROCEDURE clean_customer_data AS
    v_updated_count NUMBER := 0;
BEGIN
    -- Clean up email addresses
    UPDATE customers 
    SET email = LOWER(TRIM(email))
    WHERE email IS NOT NULL;
    
    v_updated_count := SQL%ROWCOUNT;
    
    -- Clean up phone numbers
    UPDATE customers 
    SET phone_number = REGEXP_REPLACE(phone_number, '[^0-9]', '')
    WHERE phone_number IS NOT NULL;
    
    v_updated_count := v_updated_count + SQL%ROWCOUNT;
    
    -- Clean up names
    UPDATE customers 
    SET customer_name = INITCAP(TRIM(customer_name))
    WHERE customer_name IS NOT NULL;
    
    v_updated_count := v_updated_count + SQL%ROWCOUNT;
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('Cleaned ' || v_updated_count || ' customer records');
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20020, 'Error cleaning customer data: ' || SQLERRM);
END clean_customer_data;

CREATE OR REPLACE FUNCTION generate_unique_code(
    p_prefix IN VARCHAR2 DEFAULT 'CODE',
    p_length IN NUMBER DEFAULT 8
) RETURN VARCHAR2 AS
    v_code VARCHAR2(50);
    v_counter NUMBER := 1;
    v_exists NUMBER;
BEGIN
    LOOP
        -- Generate code with prefix and random numbers
        v_code := p_prefix || LPAD(ROUND(DBMS_RANDOM.VALUE(1, 99999999)), p_length - LENGTH(p_prefix), '0');
        
        -- Check if code already exists (assuming there's a codes table)
        SELECT COUNT(*) INTO v_exists 
        FROM codes 
        WHERE code_value = v_code;
        
        EXIT WHEN v_exists = 0;
        
        v_counter := v_counter + 1;
        
        -- Prevent infinite loop
        IF v_counter > 100 THEN
            RAISE_APPLICATION_ERROR(-20021, 'Unable to generate unique code');
        END IF;
    END LOOP;
    
    RETURN v_code;
    
    EXCEPTION
        WHEN OTHERS THEN
            RETURN NULL;
END generate_unique_code;
