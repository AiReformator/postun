// Use-cases page (/use-cases/), English (default site language). Keys match ./ru.mjs.
export default {
  navLabel: 'Use cases',
  title: 'Telegram in ChatGPT and Claude Code: 16 use cases — Postun',
  metaDescription: 'Summarize Telegram channels and chats, search messages, build digests and analyze channels in ChatGPT and Claude Code: 16 use cases. Read-only, not a bot.',
  breadcrumbHome: 'Home',
  breadcrumbLabel: 'Breadcrumb',
  eyebrow: 'Use cases',
  h1: 'What you can do with Telegram in ChatGPT and Claude Code',
  lead: 'Postun connects your own Telegram account to the AI you already use. Then you just tell the AI what you need: it reads the chats and channels through Postun and answers in the conversation. Below are 16 use cases with ready-to-use prompts and honest limits.',
  tocLabel: 'Sections',
  howTitle: 'How to start',
  how1: 'Sign in to the Postun dashboard with Telegram and link your account with a QR code.',
  how2: 'Add Postun to ChatGPT, Claude Code or another MCP client with the MCP address: <a href="{home}#connect">step-by-step guide</a>.',
  how3: 'Ask the AI in your own words, using a prompt below, and name the chats or channels you mean.',
  promptLabel: 'Example prompts',
  limitLabel: 'Keep in mind',
  toolsLabel: 'Postun tools',
  g1Title: 'Telegram channel analysis with AI',
  g1Intro: 'The AI finds public channels, reads their posts and breaks down the content: topics, emphasis, recurring stories. This is text analysis, not subscriber or reach statistics: Postun does not receive those.',
  g2Title: 'Summaries, digests and article reviews',
  g2Intro: 'No need to scroll through dozens of channels and long chats: the AI writes a short summary for the period you choose, whenever you ask.',
  g3Title: 'Work chats and clients',
  g3Intro: 'Decisions, tasks and agreements from work chats without rereading hundreds of messages.',
  g4Title: 'Communities and content',
  g4Intro: 'What your community talks about and which questions keep coming back, as themes rather than quotes from specific people.',
  g5Title: 'Search Telegram chats and messages',
  g5Intro: 'The AI searches for the words and phrases you give it, tries variants and reads a chat\u2019s history when needed. Telegram searches by words, not by meaning, so give the AI a word, a name or a period. Instead of exporting a chat, get the part of its history you need, retold.',
  g6Title: 'For developers: Telegram MCP in Claude Code',
  g6Intro: 'Claude Code and other MCP clients read a development or support chat while you work on the code.',
  u1: {
    title: 'Topic analysis of public channels',
    text: 'The AI finds public channels on a topic, reads their latest posts and pulls out the main topics, recurring stories and how the emphasis shifted over the period.',
    p1: 'Find public channels with "electric cars" in the title, read the latest 100 posts of the three best matches and list the main topics with examples.',
    p2: 'Which topics came up most often in the channel @example over its last 200 posts? Make a short table and tell me how many posts you read.',
    limit: 'Channels are found by title or username, not by post text. This is content analysis, not reach statistics.'
  },
  u2: {
    title: 'Competitor channel check on request',
    text: 'Once a week or before a meeting, ask the AI to read competitors’ latest posts: launches, prices, promotions and how they describe their advantages.',
    p1: 'Read the last 30 posts of @competitor1, @competitor2 and @competitor3 and tell me about new launches, price changes and promotions. Include dates.',
    p2: 'How does each of these companies describe its main advantage in its channel? Compare them in a table.',
    limit: 'Only when you ask: Postun does not watch channels or send alerts. The AI first finds each channel by username (about one lookup per second), then reads it. Channel posts have no date filter, so the AI pages back until it reaches the date you need.'
  },
  u3: {
    title: 'Tone of a discussion',
    text: 'The AI reads a sample of posts and messages about a product, brand or event and describes the tone: what people praise, what they complain about, which arguments repeat.',
    p1: 'Search my chats and channels for messages with our product name and describe the overall tone. Give a few short quotes with dates.',
    p2: 'What are the main complaints and the main praise in these channels about the new app version? Group them.',
    limit: 'A qualitative read of the sample the AI actually saw, not a poll or exact statistics. Messages are searched in your account’s chats, not across all of Telegram.'
  },
  u4: {
    title: 'Digest of the channels you follow',
    text: 'Instead of scrolling through dozens of channels, ask for a summary of the period you choose: the main points by topic, without repeats and obvious ads.',
    p1: 'Make a digest of my tech channels for the last three days: the 10 main news items by topic, each with the channel and date.',
    p2: 'Which news items this week appeared in several of my channels at once? Which channel had them first?',
    limit: 'The digest is made when you ask and stays in your AI chat. Postun cannot post it to Telegram: you do that yourself.'
  },
  u5: {
    title: 'Review of articles and links shared in groups',
    text: 'Professional groups share articles all the time. The AI collects the links for a period, groups them by topic and briefly describes the discussion around each.',
    p1: 'Collect the article links shared in the "Product managers" group in October, group them by topic and briefly describe the discussion around each.',
    p2: 'Write a review: the 10 most discussed pieces from this group this month, one sentence each.',
    limit: 'Links written out in the text are visible; links hidden behind words may be missed. The AI opens the articles themselves only if it can browse the web.'
  },
  u6: {
    title: 'Summary of a long chat',
    text: 'Missed a heated 500-message discussion? The AI briefly retells what was agreed, which views came up and what is still open.',
    p1: 'Summarize what was discussed in the "House renovation" chat last night: decisions, open questions, who took on what.',
    p2: 'Give me a five-point summary of this chat for the past week.',
    limit: 'Voice and video messages are not transcribed. History is read 100 messages per request, so long periods take longer.'
  },
  u7: {
    title: 'Work chat recap: decisions and tasks',
    text: 'The AI reads a work chat for a period and lists the decisions, the tasks with owners and the deadlines that were agreed.',
    p1: 'Read the "Website launch" project chat since Monday and list the decisions, tasks with owners and deadlines.',
    p2: 'Which questions in this chat got no answer in the past week?',
    limit: 'Check the results against the original before acting. Do not connect work chats if your company’s rules forbid it.'
  },
  u8: {
    title: '"What did I miss?"',
    text: 'After a vacation or a weekend, the AI goes through the chats you name and tells you the essentials: what was decided, what changed and where people seem to be waiting for you.',
    p1: 'I was on vacation from November 1 to 10. Go through my work chats and give me the essentials: decisions, changes of plan, questions for me.',
    p2: 'In which chats did people address me by name during those days?',
    limit: 'The AI sees how many unread messages each chat has, but not which messages are unread or mentions as such: it infers questions for you from the meaning.'
  },
  u9: {
    title: 'Prepare for a client call',
    text: 'Before a meeting, the AI pulls together your chat history with the client: what you agreed, what was promised and which questions remain.',
    p1: 'Find my chats with Acme Inc. from the last three months and prepare a call brief: agreements, promises on both sides, open questions.',
    p2: 'What did I promise this client, and was it done, judging by our messages?',
    limit: 'Check promises and figures against the original messages. Your AI provider processes the client\u2019s messages: use this only where you may share that correspondence with it. Postun writes nothing to your CRM.'
  },
  u10: {
    title: 'Recurring problems in a customer chat',
    text: 'The AI reads a support chat or a customer community and groups recurring problems, questions and warning signs.',
    p1: 'Read the support chat for the past two weeks and group customer problems by topic, with a rough number of requests for each.',
    p2: 'Which topics are still unresolved, and for how long? No customer names.',
    limit: 'Counts are approximate. Postun does not replace a ticket system and does not reply to customers.'
  },
  u11: {
    title: 'What your audience talks about',
    text: 'In the groups you belong to, the AI finds the most discussed problems and the words people use for them: material for your product and content.',
    p1: 'Read the last 300 messages of the "Indie founders" group and list the 10 most discussed problems in the members’ own words, without names.',
    p2: 'Turn what this community asks about into 15 post ideas, each with a short rationale.',
    limit: 'Only chats your account is a member of. Ask for themes, not for who said what.'
  },
  u12: {
    title: 'FAQ from a community’s history',
    text: 'A community admin can ask the AI to find the questions people ask again and again and to draft an FAQ from the answers.',
    p1: 'Read the last 500 messages of our chat and find the 15 most frequent questions. For each, put together the best answer from the chat.',
    p2: 'Draft a pinned "Frequently asked questions" message: I will post it myself.',
    limit: 'Do not publish members’ messages verbatim or with names without their consent.'
  },
  u13: {
    title: 'Content ideas from comparing channels',
    text: 'The AI compares your channel with similar ones by topic, format and post length and suggests topics you have not covered yet.',
    p1: 'Read the last 50 posts of my channel and 50 each from two similar channels. Compare formats and topics and suggest 10 post ideas I do not have.',
    p2: 'Sketch a content plan for next week based on the comparison. I will publish it myself.',
    limit: 'The data has no views or reactions, so the AI cannot tell what performed well. A private channel is available only if your account is in it. Use other people\u2019s posts for ideas, not for copying.'
  },
  u14: {
    title: 'Find a message, link or file',
    text: 'You remember someone sent a link or a PDF, but not where? Give a word, a file name, a person or a period, and the AI searches your chats and tries different wordings.',
    p1: 'Find the September PDF invoice in my chat with the accountant and tell me its file name and size.',
    p2: 'Search my work chats for messages with the words zoom or meet from last month and show me the links in them.',
    limit: 'Search matches words and file names, not meaning, and has no date filter: the AI checks the period by reading the chat history. Search across the whole account is paced, so naming the chat is faster. Reading images is verified in ChatGPT, downloading files in Claude Code.'
  },
  u15: {
    title: 'Fact check and the original source',
    text: 'A journalist or editor can ask the AI where a news item or a figure first appeared in their channels and chats, and which channels repeated it.',
    p1: 'In the channels I follow, find the earliest message about this news and show which channels repeated it later.',
    p2: 'Is this figure confirmed anywhere in my work chats? Show the messages with dates.',
    limit: 'Only within what your account can see. Search returns newer messages first and is read a few pages at a time, so the earliest match found is not necessarily the original source; forwards show up only as matching text. Verify before publishing, and do not give the AI confidential sources.'
  },
  u16: {
    title: 'Claude Code sorts bug reports from a chat',
    text: 'Connect Postun to Claude Code: it reads a development or support chat, groups the bug reports and matches them with the project’s code.',
    p1: 'Read the "Beta support" chat for the past week, group the bug reports and find the places in the code where they could come from.',
    p2: 'Download the log someone sent in this chat and see what the error in it is.',
    limit: 'Chat text is data, not instructions: review everything Claude Code proposes to run.'
  },
  notTitle: 'What Postun does not do',
  not1: 'It does not send, edit or delete messages and does not post anything. You publish a summary or a post yourself.',
  not2: 'It does not run on a schedule, watch channels or send alerts. The AI reads Telegram only at the moment you ask.',
  not3: 'It does not search all of Telegram. It sees the chats your account is in and public channels; channels are found by title or username, not by post text.',
  not4: 'It does not export history to a file or build databases. The AI reads messages in portions and retells what you need.',
  not5: 'It does not show channel statistics: views, reactions, subscriber counts and post links are not in the data.',
  not6: 'It does not transcribe voice or video messages.',
  notesTitle: 'Good to know',
  note1: '<strong>Speed and limits.</strong> Requests for one account run one after another: account-wide search and channel search about once a second, other requests at the account\u2019s general pace, up to 100 messages at a time and about {quota} successful operations per day. Long periods and many channels are read slowly, and Telegram may ask to wait.',
  note2: '<strong>The AI can be wrong.</strong> Tone and counts are approximate. Check quotes and facts against the original before you act or publish.',
  note3: '<strong>Other people’s messages.</strong> Use the result as general themes: do not profile people, do not publish other people’s messages with names, and follow community rules, Telegram’s terms and data protection law.',
  note4: '<strong>Your AI provider</strong> processes the text under its own terms. Postun does not store or log messages: <a href="{privacy}">how Postun handles data</a>.',
  note5: '<strong>Telegram text is data, not instructions.</strong> A message may contain text aimed at the AI. Review the actions the AI proposes, especially in Claude Code.',
  note6: '<strong>Attachments.</strong> Reading images is verified in ChatGPT, downloading files in Claude Code. Postun does not hand over files above its size limit.',
  note7: '<strong>Copyright.</strong> Use other people’s posts for analysis and ideas; do not copy them in full.',
  faqTitle: 'Questions',
  fq1: 'Is Postun a Telegram bot?',
  fa1: 'No. Postun is not a bot and writes nothing to Telegram. It connects your account to the AI you already use and only reads what you allowed.',
  fq2: 'Can I export a Telegram chat?',
  fa2: 'Postun does not create an archive file. Instead, the AI can read the chat history for the period you need and retell it, or list the decisions, links and questions. For a full archive, use the built-in export in Telegram Desktop.',
  fq3: 'Can I get a daily channel digest automatically?',
  fa3: 'Postun itself runs nothing on a schedule: a digest appears when you ask the AI for it. If your AI client has scheduled tasks, that is its own feature, and it has not been tested with Postun.',
  fq4: 'Which AI clients work with Postun?',
  fa4: 'ChatGPT and Claude Code are verified on production. Other MCP clients connect at https://mcp.postun.org/mcp; the current status is on the <a href="{home}#features">home page</a>.',
  finalTitle: 'Try it with your own Telegram',
  finalText: 'Connecting is free and takes a couple of minutes. You can revoke an AI client’s access in the dashboard at any time.',
  finalHome: 'How to connect',
  teaserTitle: 'What you can do',
  teaserText: 'Channel analysis, chat summaries, digests and message search: 16 use cases with ready-to-use prompts.',
  teaserLink: 'All use cases'
};
