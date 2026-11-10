import unittest,importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('deploy',Path(__file__).resolve().parents[1]/'private/deploy_completo.py')
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)
class PublicationOrder(unittest.TestCase):
 def test_dependencies_before_application_and_activation(self):
  files=['release.json','sw.js','index.html','app.js','data-loader.js','modules/dossie.js','data/chunks/contratos_documentos.json']
  order=[x[1] for x in sorted([('',x) for x in files],key=deploy.publication_order)]
  self.assertLess(order.index('modules/dossie.js'),order.index('app.js'))
  self.assertLess(order.index('data/chunks/contratos_documentos.json'),order.index('app.js'))
  self.assertLess(order.index('app.js'),order.index('index.html'))
  self.assertLess(order.index('data-loader.js'),order.index('index.html'))
  self.assertEqual(order[-2:],['sw.js','release.json'])
