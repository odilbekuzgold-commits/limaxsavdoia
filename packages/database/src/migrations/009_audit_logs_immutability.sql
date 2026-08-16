-- Migration 009: Enforce database-level immutability for audit_logs
CREATE OR REPLACE FUNCTION prevent_audit_logs_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs records are immutable and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_immutability ON audit_logs;

CREATE TRIGGER trg_audit_logs_immutability
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_logs_modification();
