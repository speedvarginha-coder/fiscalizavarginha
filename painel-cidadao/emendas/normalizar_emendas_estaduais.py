# -*- coding: utf-8 -*-
"""Compatibilidade: a camada estadual agora é gerada pela fonte oficial.

Use `coletor_emendas_estaduais.py`. Este nome antigo permanece para não quebrar
atalhos locais, mas não volta a derivar registros da base legada.
"""
from coletor_emendas_estaduais import main


if __name__ == "__main__":
    raise SystemExit(main())
