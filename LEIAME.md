# Contagem de Inventário — contagem simultânea em tempo real

Várias pessoas contam ao mesmo tempo, cada uma no seu celular ou tablet, e o
gestor acompanha tudo ao vivo no painel (Dashboard). Os dados ficam em um
computador central que roda o `server.js`.

## Como usar no dia da contagem (passo a passo)

1. **Instale o Node.js** (só na primeira vez) no computador que vai ser o
   servidor: https://nodejs.org — versão LTS. Não é preciso instalar mais nada.
2. **(Opcional) Defina as senhas**: abra `iniciar-servidor.bat` no Bloco de
   Notas (botão direito → Editar) e preencha `SENHA_EQUIPE=` e `SENHA_GESTOR=`.
   Veja a seção *Senhas de acesso* abaixo.
3. **Inicie o servidor**:
   - Windows: dê dois cliques em `iniciar-servidor.bat`
   - Mac/Linux: rode `./iniciar-servidor.sh` (ou `node server.js`)
4. A janela mostra os endereços, por exemplo:
   ```
   Neste computador:   http://localhost:8080
   Celulares/tablets:  http://192.168.0.15:8080
   ```
5. **No computador do gestor**: abra `http://localhost:8080`, entre como
   *Gestor do portal* e importe a planilha do ERP (aba Importar).
6. **Em cada celular/tablet** (conectado no **mesmo Wi-Fi** do computador):
   abra o endereço `http://192.168...:8080` mostrado na janela, digite o nome e
   entre como *Operador de coletor*.
7. O operador escolhe o corredor, digita as quantidades contadas e toca em
   **📤 Enviar contagem** (barra fixa embaixo da lista) — tudo vai de uma vez.
8. No **Dashboard** o gestor vê, ao vivo: quem está conectado, quantas
   contagens cada um já fez, o feed das últimas contagens e os KPIs
   atualizando sozinhos.

Deixe a janela do servidor aberta durante toda a contagem. Os dados ficam
gravados em `dados/contagem.json` — se o computador reiniciar, basta iniciar
o servidor de novo que tudo continua de onde parou. Para guardar uma cópia de
segurança, copie esse arquivo.

## Começar uma contagem nova (todo mês, por exemplo)

Quando for contar o estoque de novo, **não apague nada**: inicie uma contagem
nova. A contagem anterior é encerrada, guardada no histórico com o resultado
completo, e todos os itens voltam a zero para a equipe contar do começo.

Tudo fica na aba **Importar**, no perfil de gestor. Há dois caminhos:

**1. Com uma planilha nova do ERP** (o mais comum)
1. Suba o arquivo no quadro "Subir planilha do ERP".
2. Confira o mapeamento das colunas.
3. Em *"O que fazer com a contagem atual?"*, escolha
   **🔄 Começar uma contagem nova**.
4. Dê um nome à contagem (ex.: "Inventário geral — outubro") e confirme em
   **Zerar e iniciar a nova contagem**.

**2. Com os mesmos itens, sem planilha nova**
No quadro "Contagem em andamento", clique em **🔄 Iniciar nova contagem**. Útil
para refazer uma contagem do zero sem mexer na planilha.

### Corrigir a planilha sem perder o que já foi contado
Se o arquivo do ERP veio errado ou desatualizado **no meio da contagem**, suba o
arquivo certo e escolha **📝 Só atualizar a planilha da contagem atual**. Saldos
são corrigidos, itens entram e saem, e tudo que a equipe já contou é preservado.

### O que acontece nos celulares da equipe
Assim que a contagem nova começa, cada aparelho conectado é zerado na hora e
mostra o aviso *"Uma nova contagem foi iniciada pelo gestor"*. Quantidades
digitadas e ainda não enviadas são descartadas — por isso, avise a equipe antes
de zerar.

### Contagens anteriores
Cada contagem encerrada aparece na lista **📚 Contagens anteriores**, com data,
itens contados, divergências, acurácia e valor divergente. Em cada linha:
- **⬇ Planilha** — CSV com todos os itens, as 3 contagens, a diferença e quem
  contou (abre no Excel);
- **JSON** — cópia completa, para auditoria ou para restaurar.

Baixe a planilha de cada contagem e guarde junto com os documentos do
inventário. No modo local (sem servidor) só o resumo fica guardado, então baixe
o resultado **antes** de zerar — o próprio app avisa isso na hora.

### Dicas / problemas comuns
- **Celular não abre o endereço**: confira se está no mesmo Wi-Fi (e não no
  4G/5G). No Windows, na primeira vez, o Firewall pergunta se o Node.js pode
  acessar a rede — marque "Redes privadas" e permita.
- **Wi-Fi caiu no meio do galpão**: pode continuar contando e tocar em Enviar.
  As contagens ficam guardadas no aparelho (aparecem como "⏳ aguardando
  conexão") e são enviadas sozinhas quando o sinal voltar. O selo no topo
  mostra 🟢 *Ao vivo* ou 🟠 *Sem conexão*.
- **Números digitados não se perdem**: ficam guardados no aparelho mesmo se
  trocar de aba, de corredor ou recarregar a página, até tocar em Enviar.
- **Duas pessoas contaram o mesmo item**: o servidor registra a primeira como
  1ª contagem e a outra automaticamente como 2ª (contagem cega de
  conferência). Se o item já estava finalizado, o operador é avisado.
- **Trocar a porta**: `PORTA=3000 node server.js` (Windows:
  `set PORTA=3000 && node server.js`).

## Senhas de acesso

O servidor aceita duas senhas, definidas como variáveis de ambiente:

| Variável       | Quem usa                         | O que libera                                   |
|----------------|----------------------------------|------------------------------------------------|
| `SENHA_EQUIPE` | operadores (celulares/tablets)   | contar, enviar contagens, ver telas            |
| `SENHA_GESTOR` | gestor                           | tudo acima + importar planilha, backup, apagar |

- Com **nenhuma** das duas definida, o app entra sem senha (só para rede interna).
- A senha do gestor também serve para entrar como operador.
- O servidor confere o perfil: um operador não consegue importar planilha nem
  apagar dados, mesmo que tente pelo endereço da API.
- Cada pessoa digita a senha **uma vez**: o aparelho fica conectado por até 30
  dias, até tocar em "sair".
- **Trocar a senha desconecta todo mundo** — útil se a senha vazou ou se alguém
  saiu da equipe. Basta alterar a variável e reiniciar o servidor.
- Após 10 senhas erradas seguidas, aquele aparelho fica bloqueado por 15 minutos.
- As contagens são registradas com o nome informado no login; o servidor não
  aceita que um aparelho envie contagens em nome de outra pessoa.
- Use senhas com pelo menos 8 caracteres, e diferentes entre equipe e gestor.

## Backup

Na aba **Importar**, o gestor tem o botão **💾 Baixar backup**, que baixa um
arquivo `.json` com todos os itens, contagens e o histórico. Recomendado ao fim
de cada dia de contagem. No servidor local, os dados também estão em
`dados/contagem.json`.

## Publicar na internet com o Railway (passo a passo)

Use esta opção se os aparelhos não estiverem todos no mesmo Wi-Fi (por
exemplo, em unidades diferentes ou usando 4G/5G). Custo: plano Hobby, US$ 5
por mês, que já inclui US$ 5 de uso — suficiente para este app. O Railway dá
um crédito de teste de US$ 5 para experimentar antes de pagar.

**1. Colocar os arquivos no GitHub** (é de onde o Railway pega o app)
1. Crie uma conta gratuita em https://github.com
2. Clique em **New repository**, dê um nome (ex.: `contagem-estoque`), marque
   **Private** e clique em **Create repository**.
3. Na página do repositório, clique em **uploading an existing file**.
4. Extraia este zip no computador e **arraste todo o conteúdo da pasta**
   (`index.html`, `server.js`, `package.json`, a pasta `js`, etc.) para a
   página. Clique em **Commit changes**.
   - Não envie a pasta `dados` (se existir), ela tem os dados da contagem local.

**2. Criar o projeto no Railway**
1. Acesse https://railway.com e entre com a conta do GitHub.
2. **New Project → Deploy from GitHub repo** e escolha o repositório criado.
   O Railway detecta o Node.js sozinho e inicia com `node server.js`.

**3. Definir as senhas** — obrigatório na internet
1. Clique no serviço criado → aba **Variables** → **New Variable**.
2. Crie `SENHA_EQUIPE` com a senha dos operadores.
3. Crie `SENHA_GESTOR` com a senha do gestor.

**4. Criar o volume (onde os dados ficam guardados)** — obrigatório
1. No painel do projeto, clique com o botão direito no espaço vazio (ou
   Ctrl+K / ⌘K) e escolha **Volume**.
2. Conecte ao serviço do app e use como *mount path* `/app/dados`.
3. O servidor encontra o volume automaticamente.
   ⚠ Sem o volume, **todos os dados são apagados** a cada atualização ou
   reinício do Railway.

**5. Gerar o endereço de acesso**
1. No serviço → **Settings → Networking → Generate Domain**.
2. Você recebe um endereço como `https://contagem-estoque-production.up.railway.app`
   (já com HTTPS). É esse endereço que a equipe abre no celular.

**6. Conferir**
- Na aba **Deployments → View logs**, deve aparecer
  `Proteção por senha: ATIVA (senha separada para o gestor)`.
- Abra o endereço, entre como gestor e importe a planilha.

**Atualizar o app depois:** envie os arquivos alterados para o GitHub (mesmo
processo de upload); o Railway publica a nova versão sozinho em ~1 minuto. Os
dados ficam preservados no volume. Durante essa troca, o app fica fora do ar
por alguns segundos — evite atualizar no meio de uma contagem (se acontecer,
as contagens ficam na fila dos celulares e são enviadas quando voltar).

### Modo local (sem servidor)
Se o `index.html` for aberto sem o `server.js` (arquivo direto ou hospedagem
estática como Netlify), o app funciona como antes: cada aparelho guarda só a
própria contagem, sem compartilhar. O selo no topo mostra "💾 Só neste
aparelho".

### Usar pela internet (fora da rede local)
O `server.js` roda em qualquer serviço que aceite Node.js com disco
persistente (ex.: uma VPS, Railway com volume, Fly.io com volume). Serviços
só de site estático (Netlify, GitHub Pages) **não** servem para o modo
compartilhado.

---

# Estrutura do código

Mesmo app da versão de código-fonte única, só que com `app.js` dividido em
14 arquivos menores por assunto, dentro de `js/`, mais a biblioteca de
Excel em `js/vendor/`. É o mesmo código, byte a byte — só reorganizado em
módulos para ficar mais fácil de abrir, entender e editar cada parte sem
precisar navegar um arquivo único de ~1400 linhas.

## Estrutura

```
index.html
js/
  vendor/
    xlsx.full.min.js       — biblioteca SheetJS (leitura de .xlsx/.xls/.csv)
  01-estado.js              — estado global, persistência local (localStorage), constantes
  02-utils.js                — formatação, normalização de texto, toast, auditoria, CSV
  03-regras-negocio.js       — status/divergência, contagem cega, arbitragem, itens avulsos
  04-locais.js                — agrupamento de corredores por letra, depósitos, endereços
  05-importacao.js            — leitura da planilha do ERP, mapeamento de colunas, importação
  06-render-shell.js          — render() principal, login, topbar/abas/rodapé
  07-dashboard.js             — KPIs, gráficos, card de finalizar contagem
  08-importar-ui.js           — tela de importação e mapeamento de colunas
  09-locais-ui.js              — tela de locais/corredores
  10-contagem.js               — tela de contagem (busca global, corredor, item avulso)
  11-itens-diverg-auditoria.js — telas de Itens, Divergências e Auditoria
  12-eventos.js                — delegação de eventos (clique/mudança/teclado) e exportação CSV
  13-fechamento-email.js       — resumo de fechamento e abertura do rascunho de e-mail
  15-sincronizacao.js          — conexão com o servidor, tempo real, fila offline, botão Enviar contagem, painel ao vivo
  14-boot.js                    — inicialização (conecta ao servidor ou recupera dados locais e faz a 1ª renderização)
server.js                       — servidor central (Node.js puro, sem dependências): API + tempo real + arquivos do app
iniciar-servidor.bat / .sh      — atalhos para iniciar o servidor (e onde definir as senhas no uso local)
package.json                    — usado pelo Railway (ou outro serviço) para saber como iniciar o app
dados/contagem.json             — criado automaticamente: itens, contagens e auditoria da equipe
dados/contagens-anteriores/     — criado automaticamente: resultado completo de cada contagem encerrada
```

Os arquivos são carregados nessa ordem via `<script src="js/...">` normais
(sem bundler, sem `type="module"`) — por isso a ordem no `index.html`
importa: cada módulo pode usar funções e constantes definidas nos módulos
carregados antes dele. `14-boot.js` é sempre o último, porque é ele quem
chama a primeira renderização da tela.

## Como rodar localmente

Mesma orientação da versão de arquivo único — como agora são vários
arquivos JS carregados via `<script src="...">`, abrir direto com duplo
clique (`file://`) pode ser bloqueado pelo navegador. Sirva a pasta por um
servidor local:

1. Extraia este zip em uma pasta (mantendo a estrutura de subpastas `js/`
   e `js/vendor/` intacta).
2. Abra um terminal nessa pasta.
3. Rode um servidor local:
   - Com Python 3: `python3 -m http.server 8080`
   - Com Node.js: `npx serve .`
4. Abra `http://localhost:8080` no navegador.

## Editando um módulo

Cada arquivo em `js/` pode ser editado isoladamente — por exemplo, para
mexer só na tela de Dashboard, edite `js/07-dashboard.js`, sem precisar
abrir o resto do código. Como todos os módulos compartilham o mesmo
escopo global (é JavaScript "clássico", não ES modules), qualquer `const`
ou `function` definida em um módulo já carregado fica disponível nos
módulos seguintes — não é necessário `import`/`export`.

## Publicando como site / gerando a versão única

Para publicar (Netlify, Vercel, GitHub Pages, etc.), suba a pasta inteira
mantendo a estrutura (`index.html` + `js/`). Se preferir usar/distribuir
como um único arquivo `index.html` autossuficiente (sem pasta `js/`), use
a versão "standalone" que foi entregue separadamente — ela é gerada a
partir deste mesmo código-fonte, só que com tudo colado em um arquivo só.
