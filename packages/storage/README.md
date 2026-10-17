# @rr/storage

File storage behind `StoragePort`: an in-memory mock, and local disk (`@rr/storage/local`: random names, safe paths, private permissions). Files are only ever served through the authorised `/api/files` route. An S3-compatible adapter for several servers is not written yet.
