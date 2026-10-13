import hashlib
import json
import pathlib
import zipfile

archives = list(pathlib.Path('test-results').rglob('complete-backup.zip'))
assert len(archives) == 3, '三種瀏覽器的下載檔案必須齊全'
for path in archives:
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, 'CRC 校驗必須通過'
        manifest = json.loads(archive.read('manifest.json'))
        files = [item['file'] for item in manifest['pages'] + manifest['assets']]
        names = ['manifest.json'] + [file['path'] for file in files]
        assert len(names) == len(set(names)), '清單檔名不得重複'
        assert sorted(archive.namelist()) == sorted(names)
        for file in files:
            data = archive.read(file['path'])
            assert len(data) == file['byte_size']
            assert hashlib.sha256(data).hexdigest() == file['checksum']
        assert manifest['format'] == 'p-note-backup' and manifest['version'] == 1
        assert set(manifest['owner']) == {'id'}
        assert all(info.compress_type == zipfile.ZIP_STORED for info in archive.infolist())
print('Python 標準庫獨立 ZIP／CRC／SHA-256／檔案集合解析：3／3 通過')
