import axios from 'axios';

const LANGUAGE_IDS = {
  javascript: { language: 'nodejs', versionIndex: '4' },
  typescript: { language: 'typescript', versionIndex: '5' },
  python: { language: 'python3', versionIndex: '5' },
  java: { language: 'java', versionIndex: '5' },
  cpp: { language: 'cpp17', versionIndex: '1' },
};

// Send code to JDoodle and return the result in the existing frontend format.
export const runCode = async (sourceCode, language, stdin = '') => {
  const compiler = LANGUAGE_IDS[language];
  if (!compiler) {
    throw new Error('Unsupported language');
  }

  if (!process.env.JDOODLE_CLIENT_ID || !process.env.JDOODLE_CLIENT_SECRET) {
    throw new Error('JDoodle is not configured on the server');
  }

  const response = await axios.post(
    'https://api.jdoodle.com/v1/execute',
    {
      clientId: process.env.JDOODLE_CLIENT_ID,
      clientSecret: process.env.JDOODLE_CLIENT_SECRET,
      script: sourceCode,
      language: compiler.language,
      versionIndex: compiler.versionIndex,
      stdin,
    },
    { timeout: 15000 },
  );

  const result = response.data;
  return {
    output: result.output || '',
    error: result.error || '',
    compileError: result.error || '',
    message: result.statusCode === 200 ? '' : result.output || '',
    status: result.statusCode === 200 ? 'Accepted' : 'Error',
    time: result.cpuTime,
    memory: result.memory,
  };
};
