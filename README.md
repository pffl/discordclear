<div align="center">

# 🧹 Discord  Clear by takeown (CL)

**Limpeza automatizada e inteligente de Direct Messages no Discord.**

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Windows](https://img.shields.io/badge/Platform-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)]()
[![Discord API](https://img.shields.io/badge/Discord_API-v9-5865F2?style=for-the-badge&logo=discord&logoColor=white)]()
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)]()

*Apague seu histórico de DMs e Grupos de forma rápida, segura e sem estresse.*

</div>

---

## 📖 Sobre a Ferramenta

O **Discord Deep Cleaner** é um script em Node.js projetado para gerenciar e deletar em massa as mensagens enviadas pela sua própria conta em canais de Direct Message (DMs e Grupos). 

Construído com foco em **resiliência**, ele é capaz de lidar com o sistema de *Rate Limit* (limite de requisições) do Discord, evitando bloqueios temporários e garantindo que o processo ocorra sem falhas.

> ⚠️ **Aviso:** O script apaga apenas as mensagens enviadas por **você**. As mensagens dos seus contatos estão seguras.

---

## ✨ Funcionalidades

| Recurso | Descrição |
| :--- | :--- |
| **⚡ Auto-Instalação** | Baixa e configura as dependências necessárias automaticamente na primeira execução. |
| **🔑 Extração de Tokens** | Localiza e descriptografa tokens do Discord salvos no seu Windows (via DPAPI). |
| **👁️ Validação em Tempo Real** | Verifica quais contas estão ativas e lista no menu para você escolher. |
| **🧹 Limpeza Manual** | Mostra todas as suas DMs e Grupos abertos. Escolha um número e a limpeza começa. |
| **🤖 Comando "take"** | Ativa um *listener* (modo escuta). Se você digitar `take` em qualquer DM, o script apaga todo o histórico dela. |
| **🛡️ Evasão de Rate Limit** | Utiliza algoritmos de *backoff* exponencial e leitura de headers HTTP para respeitar os limites da API. |

---

## 📋 Pré-requisitos

Antes de iniciar, certifique-se de que seu ambiente está configurado:

- 🖥️ **Sistema Operacional:** Windows (necessário para a extração nativa de tokens via DPAPI).
- 🟢 **Node.js:** Versão **20 ou superior** instalada.
- 📦 **Dependências:** O script cuida da instalação do `@primno/dpapi`. O WebSocket é nativo do Node 20+.

---

## 🚀 Como Usar (Passo a Passo)

### 1️⃣ Prepare o Ambiente
Coloque o arquivo `cl.js` em uma pasta vazia e abra o terminal (CMD ou PowerShell) nela.

### 2️⃣ Inicie o Script
Execute o comando:
```bash
node cl1.js
