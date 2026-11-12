// Use-cases page (/use-cases/), Brazilian Portuguese. Keys match ./ru.mjs.
export default {
  navLabel: 'Casos de uso',
  title: 'Telegram no ChatGPT e no Claude Code: 16 casos de uso — Postun',
  metaDescription: 'Resumir canais e grupos do Telegram, buscar mensagens e analisar canais no ChatGPT e no Claude Code: 16 casos de uso. Somente leitura, não é um bot.',
  breadcrumbHome: 'Início',
  breadcrumbLabel: 'Trilha de navegação',
  eyebrow: 'Casos de uso',
  h1: 'O que você pode fazer com o Telegram no ChatGPT e no Claude Code',
  lead: 'O Postun conecta a sua própria conta do Telegram à IA que você já usa. Depois, basta dizer à IA o que você precisa: ela lê as conversas e os canais por meio do Postun e responde na própria conversa. Abaixo estão 16 casos de uso com pedidos prontos e limites claros.',
  tocLabel: 'Seções',
  howTitle: 'Como começar',
  how1: 'Entre no painel do Postun com o Telegram e vincule a sua conta com um QR code.',
  how2: 'Adicione o Postun ao ChatGPT, ao Claude Code ou a outro cliente MCP usando o endereço MCP: <a href="{home}#connect">passo a passo</a>.',
  how3: 'Peça à IA com as suas palavras, usando um dos pedidos abaixo, e diga quais conversas ou canais você quer.',
  promptLabel: 'Exemplos de pedidos',
  limitLabel: 'Tenha em mente',
  toolsLabel: 'Ferramentas do Postun',
  g1Title: 'Analisar canais do Telegram com IA',
  g1Intro: 'A IA encontra canais públicos, lê as publicações e analisa o conteúdo: temas, ênfases, assuntos que se repetem. É análise de texto, não estatística de inscritos nem de alcance: o Postun não recebe esses dados.',
  g2Title: 'Resumos, digests e panoramas de artigos',
  g2Intro: 'Não precisa rolar dezenas de canais nem conversas enormes: a IA monta um resumo curto do período que você escolher, quando você pedir.',
  g3Title: 'Conversas de trabalho e clientes',
  g3Intro: 'Decisões, tarefas e combinados das conversas de trabalho, sem reler centenas de mensagens.',
  g4Title: 'Comunidades e conteúdo',
  g4Intro: 'Do que a sua comunidade fala e quais perguntas se repetem, em forma de temas, e não de citações de pessoas específicas.',
  g5Title: 'Buscar mensagens e conversas no Telegram',
  g5Intro: 'A IA busca pelas palavras e frases que você indicar, testa variações e, se preciso, lê o histórico da conversa. O Telegram busca por palavras, não pelo sentido, então dê à IA uma palavra, um nome ou um período. Em vez de exportar a conversa, você recebe o resumo da parte do histórico que importa.',
  g6Title: 'Para desenvolvedores: Telegram MCP no Claude Code',
  g6Intro: 'O Claude Code e outros clientes MCP leem uma conversa de desenvolvimento ou de suporte enquanto você trabalha no código.',
  u1: {
    title: 'Análise de temas de canais públicos',
    text: 'A IA encontra canais públicos sobre um assunto, lê as publicações mais recentes e destaca os temas principais, os assuntos que se repetem e como a ênfase mudou ao longo do período.',
    p1: 'Encontre canais públicos com “carros elétricos” no nome, leia as últimas 100 publicações dos três mais relevantes e liste os temas principais com exemplos.',
    p2: 'Quais temas apareceram com mais frequência no canal @example nas últimas 200 publicações? Faça uma tabela curta e diga quantas publicações você leu.',
    limit: 'Os canais são encontrados pelo nome ou pelo @usuário, não pelo texto das publicações. É análise de conteúdo, não estatística de alcance.'
  },
  u2: {
    title: 'Acompanhar canais de concorrentes sob demanda',
    text: 'Uma vez por semana ou antes de uma reunião, peça à IA que leia as publicações recentes dos concorrentes: lançamentos, preços, promoções e como eles descrevem suas vantagens.',
    p1: 'Leia as últimas 30 publicações dos canais @competitor1, @competitor2 e @competitor3 e me conte sobre novos lançamentos, mudanças de preço e promoções. Informe as datas.',
    p2: 'Como cada uma dessas empresas descreve a sua principal vantagem no canal? Compare em uma tabela.',
    limit: 'Só quando você pede: o Postun não monitora canais nem envia alertas. A IA primeiro encontra cada canal pelo @usuário (cerca de uma consulta por segundo) e só depois o lê. As publicações de canais não têm filtro por data, então a IA vai voltando até chegar à data que você precisa.'
  },
  u3: {
    title: 'Tom de uma discussão',
    text: 'A IA lê uma amostra de publicações e mensagens sobre um produto, uma marca ou um evento e descreve o tom: o que elogiam, do que reclamam, quais argumentos se repetem.',
    p1: 'Procure nas minhas conversas e canais mensagens com o nome do nosso produto e descreva o tom geral. Traga algumas citações curtas com as datas.',
    p2: 'Quais são as principais reclamações e os principais elogios nesses canais sobre a nova versão do aplicativo? Agrupe-os.',
    limit: 'É uma avaliação qualitativa da amostra lida, não uma pesquisa nem uma estatística exata. As mensagens são buscadas nas conversas da sua conta, não em todo o Telegram.'
  },
  u4: {
    title: 'Digest dos canais que você segue',
    text: 'Em vez de rolar dezenas de canais, peça um resumo do período que você escolher: o essencial por tema, sem repetições e sem propaganda evidente.',
    p1: 'Faça um digest dos meus canais de tecnologia dos últimos três dias: as 10 principais notícias por tema, cada uma com o canal e a data.',
    p2: 'Quais notícias da semana apareceram em vários dos meus canais ao mesmo tempo? Em qual canal elas saíram primeiro?',
    limit: 'O digest é feito quando você pede e fica na conversa com a IA. O Postun não pode publicá-lo no Telegram: isso é com você.'
  },
  u5: {
    title: 'Panorama de artigos e links compartilhados em grupos',
    text: 'Grupos profissionais compartilham artigos o tempo todo. A IA reúne os links de um período, agrupa por tema e descreve em poucas linhas a discussão em torno de cada um.',
    p1: 'Reúna os links de artigos compartilhados no grupo “Gerentes de Produto” em outubro, agrupe por tema e descreva brevemente a discussão sobre cada um.',
    p2: 'Faça um panorama: os 10 materiais mais comentados deste grupo no mês, uma frase sobre cada um.',
    limit: 'Os links escritos no texto aparecem; links escondidos atrás de palavras podem passar despercebidos. A IA só abre os artigos se tiver acesso à internet.'
  },
  u6: {
    title: 'Resumo de uma conversa longa',
    text: 'Perdeu uma discussão acalorada de 500 mensagens? A IA conta em poucas linhas o que ficou combinado, quais opiniões surgiram e o que ainda está em aberto.',
    p1: 'Resuma o que foi discutido na conversa “Reforma da casa” ontem à noite: decisões, perguntas em aberto e quem ficou com o quê.',
    p2: 'Faça um resumo desta conversa na última semana em cinco tópicos.',
    limit: 'Mensagens de voz e de vídeo não são transcritas. O histórico é lido em blocos de 100 mensagens por pedido, então períodos longos levam mais tempo.'
  },
  u7: {
    title: 'Resumo da conversa de trabalho: decisões e tarefas',
    text: 'A IA lê a conversa de trabalho de um período e lista as decisões, as tarefas com responsáveis e os prazos combinados.',
    p1: 'Leia a conversa do projeto “Lançamento do site” desde segunda-feira e liste as decisões, as tarefas com responsáveis e os prazos.',
    p2: 'Quais perguntas desta conversa ficaram sem resposta na última semana?',
    limit: 'Confira o resultado com o original antes de agir. Não conecte conversas de trabalho se as regras da sua empresa proíbem.'
  },
  u8: {
    title: '“O que eu perdi?”',
    text: 'Depois de férias ou de um fim de semana, a IA percorre as conversas que você indicar e conta o essencial: o que foi decidido, o que mudou e onde parecem estar esperando justamente por você.',
    p1: 'Fiquei de férias de 1 a 10 de novembro. Passe pelas minhas conversas de trabalho e me conte o essencial: decisões, mudanças de planos e perguntas para mim.',
    p2: 'Em quais conversas me chamaram pelo nome nesses dias?',
    limit: 'A IA vê quantas mensagens não lidas cada conversa tem, mas não quais mensagens são essas nem as menções como tal: ela identifica as perguntas para você pelo sentido.'
  },
  u9: {
    title: 'Preparação para uma ligação com o cliente',
    text: 'Antes da reunião, a IA reúne o histórico de mensagens com o cliente: o que foi combinado, o que foi prometido e quais dúvidas continuam abertas.',
    p1: 'Encontre as minhas conversas com a Acme Inc. dos últimos três meses e prepare um resumo para a ligação: combinados, promessas dos dois lados e pendências.',
    p2: 'O que eu prometi a este cliente e isso foi cumprido, a julgar pelas mensagens?',
    limit: 'Confira promessas e números nas mensagens originais. As mensagens do cliente vão para o seu provedor de IA: use este caso só se você puder compartilhar essa conversa com ele. O Postun não grava nada no seu CRM: leve o resultado para lá por conta própria.'
  },
  u10: {
    title: 'Problemas recorrentes na conversa com clientes',
    text: 'A IA lê uma conversa de suporte ou uma comunidade de clientes e agrupa problemas recorrentes, dúvidas e sinais de alerta.',
    p1: 'Leia a conversa de suporte das últimas duas semanas e agrupe os problemas dos clientes por tema, com o número aproximado de solicitações de cada um.',
    p2: 'Quais temas continuam sem solução e há quanto tempo? Sem nomes de clientes.',
    limit: 'As contagens são aproximadas. O Postun não substitui um sistema de chamados e não responde aos clientes.'
  },
  u11: {
    title: 'Sobre o que o seu público fala',
    text: 'Nos grupos de que você participa, a IA encontra os problemas mais debatidos e as palavras que as pessoas usam para descrevê-los: material para o seu produto e o seu conteúdo.',
    p1: 'Leia as últimas 300 mensagens do grupo “Fundadores Indie” e liste os 10 problemas mais debatidos, com as palavras dos próprios participantes e sem nomes.',
    p2: 'Transforme o que essa comunidade pergunta em 15 ideias de publicações, cada uma com uma justificativa curta.',
    limit: 'Só as conversas de que a sua conta participa. Peça temas, não “quem disse o quê”.'
  },
  u12: {
    title: 'FAQ a partir do histórico da comunidade',
    text: 'Quem administra uma comunidade pode pedir à IA que encontre as perguntas feitas várias vezes e monte um rascunho de FAQ com base nas respostas.',
    p1: 'Leia as últimas 500 mensagens do nosso grupo e encontre as 15 perguntas mais frequentes. Para cada uma, monte a melhor resposta dada no grupo.',
    p2: 'Escreva um rascunho da mensagem fixada “Perguntas frequentes”: eu mesmo publico.',
    limit: 'Não publique mensagens de participantes ao pé da letra nem com nomes sem o consentimento deles.'
  },
  u13: {
    title: 'Ideias de conteúdo ao comparar canais',
    text: 'A IA compara o seu canal com canais parecidos em temas, formatos e tamanho das publicações e sugere assuntos que você ainda não abordou.',
    p1: 'Leia as últimas 50 publicações do meu canal e 50 de cada um de dois canais parecidos. Compare formatos e temas e sugira 10 ideias de publicação que eu ainda não tenho.',
    p2: 'Monte um plano de conteúdo para a próxima semana com base na comparação. Eu mesmo publico.',
    limit: 'Os dados não incluem visualizações nem reações, então a IA não sabe o que deu certo. Um canal privado só fica acessível se a sua conta fizer parte dele. Use as publicações dos outros como inspiração, não para copiar.'
  },
  u14: {
    title: 'Encontrar uma mensagem, um link ou um arquivo',
    text: 'Lembra que alguém mandou um link ou um PDF, mas não sabe onde? Diga uma palavra, o nome do arquivo, a pessoa ou o período, e a IA procura nas suas conversas, testando formulações diferentes.',
    p1: 'Encontre na conversa com a contabilidade a fatura em PDF de setembro e me diga o nome e o tamanho do arquivo.',
    p2: 'Procure nas minhas conversas de trabalho mensagens com as palavras zoom, meet ou “reunião” do mês passado e mostre os links que aparecem nelas.',
    limit: 'A busca encontra palavras e nomes de arquivos, não o sentido, e não filtra por data: o período a IA confere lendo o histórico da conversa. A busca em toda a conta tem ritmo limitado, então é mais rápido se você citar a conversa. A leitura de imagens foi verificada no ChatGPT e o download de arquivos, no Claude Code.'
  },
  u15: {
    title: 'Checagem de fatos e da fonte original',
    text: 'Jornalistas e editores podem pedir à IA que descubra onde uma notícia ou um número apareceu primeiro nos seus canais e conversas e quais canais o repetiram.',
    p1: 'Nos canais que eu sigo, encontre a mensagem mais antiga sobre esta notícia e mostre quais canais a repetiram depois.',
    p2: 'Este número é confirmado em alguma das minhas conversas de trabalho? Mostre as mensagens com as datas.',
    limit: 'Só dentro do que a sua conta enxerga. A busca mostra primeiro as mensagens mais recentes e é lida em várias páginas, então a mais antiga encontrada não é necessariamente a fonte original; encaminhamentos aparecem apenas como texto coincidente. Confirme antes de publicar e não passe fontes confidenciais para a IA.'
  },
  u16: {
    title: 'O Claude Code organiza relatos de bugs vindos de uma conversa',
    text: 'Conecte o Postun ao Claude Code: ele lê uma conversa de desenvolvimento ou de suporte, agrupa os relatos de erros e os relaciona ao código do projeto.',
    p1: 'Leia a conversa “Suporte do beta” da última semana, agrupe os relatos de erros e encontre no código os pontos de onde eles podem vir.',
    p2: 'Baixe o log que enviaram nesta conversa e veja que erro é esse.',
    limit: 'As mensagens da conversa são dados, não instruções: revise tudo o que o Claude Code propuser executar.'
  },
  notTitle: 'O que o Postun não faz',
  not1: 'Não envia, não edita e não exclui mensagens e não publica nada. Você mesmo publica qualquer resumo ou post.',
  not2: 'Não funciona em horários programados, não monitora canais e não envia alertas. A IA lê o Telegram só no momento em que você pede.',
  not3: 'Não busca em todo o Telegram. Ele enxerga as conversas de que a sua conta participa e os canais públicos; os canais são encontrados pelo nome ou pelo @usuário, não pelo texto das publicações.',
  not4: 'Não exporta o histórico para um arquivo nem monta bases de dados. A IA lê as mensagens em blocos e resume o que você precisa.',
  not5: 'Não mostra estatísticas de canais: visualizações, reações, número de inscritos e links das publicações não fazem parte dos dados.',
  not6: 'Não transcreve mensagens de voz nem de vídeo.',
  notesTitle: 'O que vale saber',
  note1: '<strong>Velocidade e limites.</strong> Os pedidos de uma mesma conta são processados um após o outro, a busca em toda a conta e a busca de canais ocorrem cerca de uma vez por segundo, os demais pedidos seguem o ritmo geral da conta, com até 100 mensagens por vez e cerca de {quota} operações bem-sucedidas por dia. Períodos longos e muitos canais são lidos devagar, e o Telegram pode pedir que você espere.',
  note2: '<strong>A IA pode errar.</strong> Tom e contagens são aproximados. Confira citações e fatos com o original antes de agir ou publicar.',
  note3: '<strong>Mensagens de outras pessoas.</strong> Use o resultado como temas gerais: não monte perfis de pessoas, não publique mensagens alheias com nomes e respeite as regras das comunidades, os termos do Telegram e a legislação de proteção de dados.',
  note4: '<strong>O seu provedor de IA</strong> processa o texto segundo as regras dele. O Postun não armazena nem registra mensagens: <a href="{privacy}">como o Postun trata os dados</a>.',
  note5: '<strong>As mensagens do Telegram são dados, não instruções.</strong> Uma mensagem pode conter texto dirigido à IA. Revise as ações que a IA propuser, principalmente no Claude Code.',
  note6: '<strong>Anexos.</strong> A leitura de imagens foi verificada no ChatGPT e o download de arquivos, no Claude Code. O Postun não entrega arquivos grandes demais.',
  note7: '<strong>Direitos autorais.</strong> Use as publicações dos outros para análise e ideias; não as copie por inteiro.',
  faqTitle: 'Perguntas frequentes',
  fq1: 'O Postun é um bot do Telegram?',
  fa1: 'Não. O Postun não é um bot e não escreve nada no Telegram. Ele conecta a sua conta à IA que você já usa e só lê o que você permitiu.',
  fq2: 'Dá para exportar uma conversa do Telegram?',
  fa2: 'O Postun não cria um arquivo de exportação. Em vez disso, a IA pode ler o histórico da conversa no período que você precisa e resumi-lo, ou listar decisões, links e perguntas. Para um arquivo completo, use a exportação integrada do Telegram Desktop.',
  fq3: 'Dá para receber um digest dos canais automaticamente todo dia?',
  fa3: 'O Postun em si não executa nada em horários programados: o digest aparece quando você o pede à IA. Se o seu cliente de IA tiver tarefas agendadas, esse é um recurso dele, e ele não foi testado com o Postun.',
  fq4: 'Com quais clientes de IA o Postun funciona?',
  fa4: 'O ChatGPT e o Claude Code foram verificados em produção. Outros clientes MCP se conectam pelo endereço https://mcp.postun.org/mcp; o status atual está na <a href="{home}#features">página inicial</a>.',
  finalTitle: 'Experimente com o seu Telegram',
  finalText: 'A conexão é gratuita e leva alguns minutos. Você pode revogar o acesso de um cliente de IA no painel a qualquer momento.',
  finalHome: 'Como conectar',
  teaserTitle: 'O que você pode fazer',
  teaserText: 'Análise de canais, resumos de conversas, digests e busca de mensagens: 16 casos de uso com pedidos prontos.',
  teaserLink: 'Todos os casos de uso'
};
