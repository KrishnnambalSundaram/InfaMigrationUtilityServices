-- Data Migration and ETL Procedures
-- Sample Oracle PL/SQL for data processing

CREATE OR REPLACE PROCEDURE migrate_legacy_customers(
    p_batch_size IN NUMBER DEFAULT 1000
) AS
    v_processed_count NUMBER := 0;
    v_error_count NUMBER := 0;
    v_batch_count NUMBER := 0;
    
    CURSOR legacy_customers IS
        SELECT 
            legacy_id,
            full_name,
            email_address,
            phone,
            address_line1,
            address_line2,
            city,
            state,
            zip_code,
            created_on
        FROM legacy_customer_table
        WHERE migration_status IS NULL
        ORDER BY legacy_id;
        
BEGIN
    DBMS_OUTPUT.PUT_LINE('Starting legacy customer migration...');
    
    FOR rec IN legacy_customers LOOP
        BEGIN
            -- Clean and validate data
            DECLARE
                v_clean_name VARCHAR2(100);
                v_clean_email VARCHAR2(100);
                v_clean_phone VARCHAR2(20);
                v_full_address VARCHAR2(200);
                v_new_customer_id NUMBER;
            BEGIN
                -- Clean customer name
                v_clean_name := INITCAP(TRIM(rec.full_name));
                
                -- Clean email
                v_clean_email := LOWER(TRIM(rec.email_address));
                
                -- Clean phone number
                v_clean_phone := REGEXP_REPLACE(rec.phone, '[^0-9]', '');
                
                -- Build full address
                v_full_address := TRIM(rec.address_line1 || ' ' || 
                                      NVL(rec.address_line2, '') || ' ' ||
                                      rec.city || ', ' || rec.state || ' ' || rec.zip_code);
                
                -- Create new customer
                SELECT customer_seq.NEXTVAL INTO v_new_customer_id FROM DUAL;
                
                INSERT INTO customers (
                    customer_id,
                    customer_name,
                    email,
                    phone_number,
                    address,
                    created_date
                ) VALUES (
                    v_new_customer_id,
                    v_clean_name,
                    v_clean_email,
                    v_clean_phone,
                    v_full_address,
                    rec.created_on
                );
                
                -- Update legacy record
                UPDATE legacy_customer_table
                SET migration_status = 'COMPLETED',
                    new_customer_id = v_new_customer_id,
                    migration_date = SYSDATE
                WHERE legacy_id = rec.legacy_id;
                
                v_processed_count := v_processed_count + 1;
                
            END;
            
        EXCEPTION
            WHEN OTHERS THEN
                -- Log error and continue
                UPDATE legacy_customer_table
                SET migration_status = 'ERROR',
                    error_message = SQLERRM,
                    migration_date = SYSDATE
                WHERE legacy_id = rec.legacy_id;
                
                v_error_count := v_error_count + 1;
                DBMS_OUTPUT.PUT_LINE('Error migrating customer ' || rec.legacy_id || ': ' || SQLERRM);
        END;
        
        -- Commit in batches
        v_batch_count := v_batch_count + 1;
        IF v_batch_count >= p_batch_size THEN
            COMMIT;
            v_batch_count := 0;
            DBMS_OUTPUT.PUT_LINE('Processed ' || v_processed_count || ' customers, ' || v_error_count || ' errors');
        END IF;
        
    END LOOP;
    
    -- Final commit
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('Migration completed. Processed: ' || v_processed_count || ', Errors: ' || v_error_count);
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20029, 'Error in migration process: ' || SQLERRM);
END migrate_legacy_customers;

CREATE OR REPLACE PROCEDURE sync_external_product_catalog AS
    v_synced_count NUMBER := 0;
    v_updated_count NUMBER := 0;
    v_error_count NUMBER := 0;
    
BEGIN
    DBMS_OUTPUT.PUT_LINE('Starting external product catalog sync...');
    
    -- Process external products
    FOR rec IN (
        SELECT 
            external_product_id,
            product_name,
            description,
            price,
            category_name,
            last_updated
        FROM external_product_feed
        WHERE sync_status IS NULL OR sync_status = 'PENDING'
    ) LOOP
        BEGIN
            -- Check if product already exists
            DECLARE
                v_existing_product_id NUMBER;
                v_category_id NUMBER;
            BEGIN
                -- Get or create category
                SELECT category_id INTO v_category_id
                FROM categories
                WHERE category_name = rec.category_name;
                
                EXCEPTION
                    WHEN NO_DATA_FOUND THEN
                        INSERT INTO categories (category_id, category_name, description)
                        VALUES (category_seq.NEXTVAL, rec.category_name, 'Auto-created from external feed');
                        SELECT category_id INTO v_category_id
                        FROM categories
                        WHERE category_name = rec.category_name;
                END;
                
                -- Check if product exists
                BEGIN
                    SELECT product_id INTO v_existing_product_id
                    FROM products
                    WHERE product_name = rec.product_name;
                    
                    -- Update existing product
                    UPDATE products
                    SET description = rec.description,
                        price = rec.price,
                        category_id = v_category_id,
                        last_updated = SYSDATE
                    WHERE product_id = v_existing_product_id;
                    
                    v_updated_count := v_updated_count + 1;
                    
                EXCEPTION
                    WHEN NO_DATA_FOUND THEN
                        -- Create new product
                        INSERT INTO products (
                            product_id,
                            product_name,
                            description,
                            price,
                            category_id,
                            created_date
                        ) VALUES (
                            product_seq.NEXTVAL,
                            rec.product_name,
                            rec.description,
                            rec.price,
                            v_category_id,
                            SYSDATE
                        );
                        
                        v_synced_count := v_synced_count + 1;
                END;
                
                -- Update external feed status
                UPDATE external_product_feed
                SET sync_status = 'COMPLETED',
                    sync_date = SYSDATE
                WHERE external_product_id = rec.external_product_id;
                
            END;
            
        EXCEPTION
            WHEN OTHERS THEN
                -- Log error
                UPDATE external_product_feed
                SET sync_status = 'ERROR',
                    error_message = SQLERRM,
                    sync_date = SYSDATE
                WHERE external_product_id = rec.external_product_id;
                
                v_error_count := v_error_count + 1;
                DBMS_OUTPUT.PUT_LINE('Error syncing product ' || rec.external_product_id || ': ' || SQLERRM);
        END;
    END LOOP;
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('Sync completed. New: ' || v_synced_count || ', Updated: ' || v_updated_count || ', Errors: ' || v_error_count);
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20030, 'Error in sync process: ' || SQLERRM);
END sync_external_product_catalog;

CREATE OR REPLACE FUNCTION validate_data_quality RETURN NUMBER AS
    v_total_records NUMBER := 0;
    v_invalid_records NUMBER := 0;
    v_quality_score NUMBER;
BEGIN
    -- Count total customers
    SELECT COUNT(*) INTO v_total_records FROM customers;
    
    -- Count invalid records
    SELECT COUNT(*) INTO v_invalid_records
    FROM customers
    WHERE customer_name IS NULL
    OR LENGTH(TRIM(customer_name)) = 0
    OR (email IS NOT NULL AND NOT REGEXP_LIKE(email, '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'));
    
    -- Calculate quality score
    IF v_total_records > 0 THEN
        v_quality_score := ROUND(((v_total_records - v_invalid_records) / v_total_records) * 100, 2);
    ELSE
        v_quality_score := 0;
    END IF;
    
    -- Log quality metrics
    INSERT INTO data_quality_log (
        check_id,
        check_date,
        total_records,
        invalid_records,
        quality_score,
        check_type
    ) VALUES (
        quality_seq.NEXTVAL,
        SYSDATE,
        v_total_records,
        v_invalid_records,
        v_quality_score,
        'CUSTOMER_DATA_QUALITY'
    );
    
    COMMIT;
    
    RETURN v_quality_score;
    
    EXCEPTION
        WHEN OTHERS THEN
            RETURN 0;
END validate_data_quality;
