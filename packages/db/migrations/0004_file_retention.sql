-- Screenshots are not kept for ever (no object storage needed): a work-proof screenshot is deleted 30 days after its review
-- decision, a ticket image 30 days after its ticket is resolved. Payment-proof screenshots are kept. The file row stays (every
-- record keeps pointing at it); only the stored bytes go, and purged_at says when.
alter table files add column purged_at timestamptz;
create index files_unpurged_kind_idx on files (kind) where purged_at is null;
