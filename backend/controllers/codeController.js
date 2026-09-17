import { runCode } from '../services/codeService.js';

// Validate the execution request and return the JDoodle result.
export const executeCode = async (req, res) => {
  const { sourceCode, language, stdin } = req.body;

  if (typeof sourceCode !== 'string' || !sourceCode.trim()) {
    return res.status(400).json({ message: 'Source code is required' });
  }

  if (typeof language !== 'string') {
    return res.status(400).json({ message: 'Language is required' });
  }

  if (stdin !== undefined && typeof stdin !== 'string') {
    return res.status(400).json({ message: 'Input must be text' });
  }

  try {
    const result = await runCode(sourceCode, language, stdin || '');
    return res.status(200).json(result);
  } catch (error) {
    console.error('Code execution error:', error.message);
    return res.status(500).json({ message: error.message || 'Code execution failed' });
  }
};
