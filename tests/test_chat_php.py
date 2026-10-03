import json
import shutil
import subprocess
import tempfile
import unittest
import socket
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NL = chr(10)
PHP = shutil.which('php') or ('C:/xampp/php/php.exe' if Path('C:/xampp/php/php.exe').exists() else None)


@unittest.skipUnless(PHP, 'Runtime PHP indisponível')
class ChatPersistenceTests(unittest.TestCase):
    def test_utf8_limits_preserve_accents_emoji_and_valid_json(self):
        source = (ROOT / 'painel-cidadao/chat.php').read_text(encoding='utf8')
        function = source[source.index('function limitarTextoUtf8('):source.index('// Valide a entrada')]
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / 'utf8.php'
            script.write_text('<?php\n' + function + "echo json_encode([limitarTextoUtf8(str_repeat('a', 499) . 'á😀', 500), limitarTextoUtf8(str_repeat('b', 1199) . '😀á', 1200)]);", encoding='utf8')
            result = subprocess.run([PHP, str(script)], capture_output=True, text=True, encoding='utf8', check=True)
            self.assertEqual(json.loads(result.stdout), ['a' * 499 + 'á', 'b' * 1199 + '😀'])

    def test_invalid_http_payloads_return_400_before_consuming_quota(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
            sock.close()
            server = subprocess.Popen([PHP, '-d', 'sys_temp_dir=' + directory, '-S', f'127.0.0.1:{port}',
                                       '-t', str(ROOT / 'painel-cidadao')], stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL,
                                      creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            try:
                for _ in range(50):
                    try:
                        with socket.create_connection(('127.0.0.1', port), timeout=.2):
                            break
                    except OSError:
                        time.sleep(.1)
                for payload in [b'not-json', b'[]', b'{"pergunta":[]}',
                                b'{"pergunta":"teste","historico":[{"texto":{}}]}',
                                b'{"pergunta":"teste","historico":"invalido"}']:
                    request = urllib.request.Request(f'http://127.0.0.1:{port}/chat.php', data=payload,
                                                     headers={'Origin': 'http://127.0.0.1:8000'}, method='POST')
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(request, timeout=5)
                    self.assertEqual(error.exception.code, 400)
                    error.exception.close()
                self.assertFalse((Path(directory) / 'fiscaliza_rl').exists())
            finally:
                server.terminate()
                server.wait(timeout=5)

    def test_counter_preserves_limits_and_fails_closed_on_corruption_or_unwritable_storage(self):
        source = (ROOT / 'painel-cidadao/chat.php').read_text(encoding='utf8')
        function = source[source.index('function contarUso('):source.index('function verificarContador(')]
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / 'test.php'
            storage = Path(directory) / 'storage'
            code = '<?php\n' + function.replace('sys_get_temp_dir()', json.dumps(str(storage))) + '''
$a = contarUso('test', 900);
$b = contarUso('test', 900);
file_put_contents('STORAGE/fiscaliza_rl/test.json', 'corrompido');
$c = contarUso('test', 900);
echo json_encode([$a, $b, $c]);
'''.replace('STORAGE', storage.as_posix())
            script.write_text(code, encoding='utf8')
            result = subprocess.run([PHP, str(script)], capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(result.stdout), [1, 2, None])
            shutil.rmtree(storage)
            storage.write_text('não é diretório', encoding='utf8')
            script.write_text('<?php\n' + function.replace('sys_get_temp_dir()', json.dumps(str(storage))) +
                              "echo json_encode(contarUso('test', 900));", encoding='utf8')
            result = subprocess.run([PHP, str(script)], capture_output=True, text=True, check=True)
            self.assertIsNone(json.loads(result.stdout))

    def test_counter_uses_private_dir_and_falls_back_to_system_temp(self):
        source = (ROOT / 'painel-cidadao/chat.php').read_text(encoding='utf8')
        function = source[source.index('function contarUso('):source.index('function verificarContador(')]
        with tempfile.TemporaryDirectory() as directory:
            tmp, privado, bloqueado = (Path(directory) / n for n in ('tmp', 'privado', 'bloqueado'))
            tmp.mkdir()
            bloqueado.write_text('arquivo, nao diretorio', encoding='utf8')
            codigo = '<?php' + NL + function.replace('sys_get_temp_dir()', json.dumps(tmp.as_posix())) + f'''
$GLOBALS['FISCALIZA_RL_DIR'] = {json.dumps(privado.as_posix())};
$a = contarUso('x', 900);
$GLOBALS['FISCALIZA_RL_DIR'] = {json.dumps(bloqueado.as_posix())};
$b = contarUso('y', 900);
echo json_encode([$a, $b]);
'''
            script = Path(directory) / 'fallback.php'
            script.write_text(codigo, encoding='utf8')
            saida = subprocess.run([PHP, str(script)], capture_output=True, text=True, check=True).stdout
            self.assertEqual(json.loads(saida), [1, 1])
            self.assertTrue((privado / 'fiscaliza_rl' / 'x.json').exists())
            self.assertTrue((tmp / 'fiscaliza_rl' / 'y.json').exists())


if __name__ == '__main__':
    unittest.main()
