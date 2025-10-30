WITH recent_orders AS (
  SELECT o.order_id,
         o.user_id,
         o.amount,
         o.created_date,
         ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.created_date DESC) AS rn
  FROM orders o
  WHERE o.created_date >= DATE '2024-01-01'
),
top_orders AS (
  SELECT ro.*
  FROM recent_orders ro
  WHERE ro.rn <= 5
)
SELECT u.user_id,
       u.region,
       COUNT(t.order_id) AS last5_count,
       SUM(t.amount) AS last5_amount,
       AVG(t.amount) AS last5_avg
FROM users u
LEFT JOIN top_orders t ON t.user_id = u.user_id
GROUP BY u.user_id, u.region
ORDER BY last5_amount DESC NULLS LAST;

