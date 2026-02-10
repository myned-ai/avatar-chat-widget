/**
 * PCM16 Audio Worklet Processor
 * Converts browser audio (Float32, 48kHz) to PCM16 (Int16, 24kHz)
 * Runs on dedicated audio thread for better performance
 */

class PCM16Processor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Resampling state
    this.resampleBuffer = [];
    this.sampleIndex = 0;
    this.TARGET_SAMPLE_RATE = 24000;
    this.TARGET_BUFFER_SIZE = 2400; // 100ms at 24kHz

    // Will be set from main thread
    this.inputSampleRate = 48000; // Default, will be updated
    this.resampleRatio = this.inputSampleRate / this.TARGET_SAMPLE_RATE;

    // Debug counter
    this.debugCounter = 0;

    // Listen for messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'config') {
        // Update input sample rate
        if (event.data.inputSampleRate) {
          this.inputSampleRate = event.data.inputSampleRate;
        }
        
        // Update target sample rate if provided by server
        if (event.data.targetSampleRate) {
          this.TARGET_SAMPLE_RATE = event.data.targetSampleRate;
          this.TARGET_BUFFER_SIZE = Math.floor(this.TARGET_SAMPLE_RATE * 0.1); // 100ms buffer
        }
        
        this.resampleRatio = this.inputSampleRate / this.TARGET_SAMPLE_RATE;
        console.log(`[Worklet] Configured: inputRate=${this.inputSampleRate}Hz, targetRate=${this.TARGET_SAMPLE_RATE}Hz, resampleRatio=${this.resampleRatio.toFixed(2)}`);
      }
    };
  }

  /**
   * Process audio data - called for each audio block (128 samples)
   * @param {Float32Array[][]} inputs - Input audio data
   * @param {Float32Array[][]} outputs - Output audio data (unused)
   * @param {Object} parameters - Parameters (unused)
   * @returns {boolean} - true to keep processor alive
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // No input or no channels
    if (!input || !input[0]) {
      return true;
    }

    const inputData = input[0]; // Mono channel
    this.debugCounter++;

    // Debug: Log first callback and then every 100th
    if (this.debugCounter === 1 || this.debugCounter % 100 === 0) {
      let maxVal = -Infinity;
      let minVal = Infinity;
      let sum = 0;

      for (let i = 0; i < inputData.length; i++) {
        const val = inputData[i];
        if (val > maxVal) maxVal = val;
        if (val < minVal) minVal = val;
        sum += Math.abs(val);
      }

      const avg = sum / inputData.length;

      // Only log if there's actual audio (not silence)
      if (avg > 0.0001) {
        this.port.postMessage({
          type: 'debug',
          data: {
            counter: this.debugCounter,
            min: minVal.toFixed(4),
            max: maxVal.toFixed(4),
            avg: avg.toFixed(6),
            samples: inputData.length
          }
        });
      }
    }

    // Downsample from native rate to 24kHz using simple decimation
    for (let i = 0; i < inputData.length; i++) {
      this.sampleIndex++;

      if (this.sampleIndex >= this.resampleRatio) {
        this.sampleIndex -= this.resampleRatio;
        this.resampleBuffer.push(inputData[i]);
      }
    }

    // When we have enough samples, send a chunk
    while (this.resampleBuffer.length >= this.TARGET_BUFFER_SIZE) {
      const chunk = this.resampleBuffer.splice(0, this.TARGET_BUFFER_SIZE);

      // Convert Float32 [-1, 1] to Int16 [-32768, 32767]
      const pcm16 = new Int16Array(this.TARGET_BUFFER_SIZE);

      for (let j = 0; j < this.TARGET_BUFFER_SIZE; j++) {
        // Clamp to [-1, 1] range
        const clamped = Math.max(-1, Math.min(1, chunk[j]));

        // Convert to 16-bit integer
        pcm16[j] = clamped < 0
          ? clamped * 0x8000  // -32768
          : clamped * 0x7FFF; // 32767
      }

      // Send PCM16 data to main thread
      // Transfer ownership for zero-copy (performance optimization)
      this.port.postMessage(
        {
          type: 'audio',
          data: pcm16.buffer
        },
        [pcm16.buffer] // Transfer ownership
      );
    }

    // Keep processor alive
    return true;
  }
}

// Register the processor
registerProcessor('pcm16-processor', PCM16Processor);
