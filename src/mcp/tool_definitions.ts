export const TOOL_DEFINITIONS = [
  {
    name: 'index_project',
    description: 'Recursively index a directory into the knowledge hypergraph. Chunks code via AST, generates skeletons, and computes embeddings.',
    inputSchema: {
      type: 'object',
      properties: {
        path:      { type: 'string', description: 'Absolute path to the directory to index' },
        languages: { type: 'array', items: { type: 'string' }, description: 'Languages to index (default: all supported)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'update_file',
    description: 'Re-index a single file, compute diff vs stored version, store VERSION_OF edge.',
    inputSchema: {
      type: 'object',
      properties: {
        file_uri: { type: 'string', description: 'Absolute path to the file' },
      },
      required: ['file_uri'],
    },
  },
  {
    name: 'log_conversation',
    description: 'Store a conversation turn. Auto-generates micro-summary; triggers meso-block after every 5 turns.',
    inputSchema: {
      type: 'object',
      properties: {
        role:       { type: 'string', enum: ['user', 'assistant', 'system'] },
        content:    { type: 'string', description: 'Message content' },
        session_id: { type: 'string', description: 'Session identifier' },
      },
      required: ['role', 'content', 'session_id'],
    },
  },
  {
    name: 'remember',
    description: 'Store a decision, task, or fact with auto-linking to related code chunks.',
    inputSchema: {
      type: 'object',
      properties: {
        statement: { type: 'string', description: 'The fact, decision, or task to remember' },
        type:      { type: 'string', enum: ['decision', 'task', 'fact'], description: 'Node type' },
        tags:      { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
        importance: { type: 'number', description: 'Importance 0-1 (default 0.8 for decisions)' },
      },
      required: ['statement', 'type'],
    },
  },
  {
    name: 'search_memory',
    description: 'Hybrid semantic + graph search with token budget. Returns ranked context items.',
    inputSchema: {
      type: 'object',
      properties: {
        query:        { type: 'string', description: 'Search query' },
        budget_tokens: { type: 'number', description: 'Max tokens to return (default 2000)' },
        active_file:  { type: 'string', description: 'Currently open file path (for graph boost)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'assemble_context',
    description: 'Master tool: builds the optimal context block for the current query within a token budget.',
    inputSchema: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'The current query or task' },
        active_file: { type: 'string', description: 'Currently open file path' },
        budget:      { type: 'number', description: 'Token budget (default 2000)' },
        session_id:  { type: 'string', description: 'Session ID for essentials lookup' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_context_delta',
    description: 'Return only the context items that are new since the last assemble_context call in this session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session identifier' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'compress_text',
    description: 'Compress arbitrary text via skeleton extraction, diff summarisation, or summarisation.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to compress' },
        mode: { type: 'string', enum: ['skeleton', 'diff', 'summary'], description: 'Compression mode' },
      },
      required: ['text', 'mode'],
    },
  },
  {
    name: 'prefetch',
    description: 'Pre-warm the retrieval cache based on IDE signals (file open, cursor move, build error).',
    inputSchema: {
      type: 'object',
      properties: {
        signal:   { type: 'string', enum: ['file_open', 'cursor_move', 'build_error'], description: 'Signal type' },
        file_uri: { type: 'string', description: 'File path associated with the signal' },
        line:     { type: 'number', description: 'Line number (for cursor_move)' },
      },
      required: ['signal', 'file_uri'],
    },
  },
  {
    name: 'generate_qms',
    description: 'Generate a Quantum Memory Seed from the current session — a 384d embedding snapshot + top-50 node list.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session identifier to generate QMS for' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'load_qms',
    description: 'Restore memory from a Quantum Memory Seed — pre-warms cache with 100 nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        qms_id: { type: 'string', description: 'QMS node ID to load' },
      },
      required: ['qms_id'],
    },
  },
  {
    name: 'feedback',
    description: 'Rate the quality of the last context assembly (1-5). Queues weight update for nightly tuner.',
    inputSchema: {
      type: 'object',
      properties: {
        score:      { type: 'number', description: 'Quality score 1-5' },
        session_id: { type: 'string', description: 'Session ID being rated' },
        source:     { type: 'string', description: 'Who provided the score (user, implicit)' },
      },
      required: ['score', 'session_id'],
    },
  },
] as const;
