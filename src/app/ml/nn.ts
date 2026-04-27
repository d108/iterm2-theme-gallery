export interface NeuralNetworkState {
  inputSize: number;
  hiddenSize: number;
  outputSize: number;
  weights1: number[][];
  weights2: number[][];
  bias1: number[];
  bias2: number[];
}

export class NeuralNetwork {
  private inputSize: number;
  private hiddenSize: number;
  private outputSize: number;
  private weights1: number[][];
  private weights2: number[][];
  private bias1: number[];
  private bias2: number[];
  private learningRate: number = 0.1;

  constructor(inputSize: number, hiddenSize: number, outputSize: number, state?: NeuralNetworkState) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;

    if (state) {
      this.weights1 = state.weights1.map(r => [...r]);
      this.weights2 = state.weights2.map(r => [...r]);
      this.bias1 = [...state.bias1];
      this.bias2 = [...state.bias2];
    } else {
      this.weights1 = Array.from({ length: inputSize }, () =>
        Array.from({ length: hiddenSize }, () => Math.random() * 2 - 1)
      );
      this.weights2 = Array.from({ length: hiddenSize }, () =>
        Array.from({ length: outputSize }, () => Math.random() * 2 - 1)
      );
      this.bias1 = Array.from({ length: hiddenSize }, () => Math.random() * 2 - 1);
      this.bias2 = Array.from({ length: outputSize }, () => Math.random() * 2 - 1);
    }
  }

  getState(): NeuralNetworkState {
    return {
      inputSize: this.inputSize,
      hiddenSize: this.hiddenSize,
      outputSize: this.outputSize,
      weights1: this.weights1.map(r => [...r]),
      weights2: this.weights2.map(r => [...r]),
      bias1: [...this.bias1],
      bias2: [...this.bias2],
    };
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  private sigmoidDerivative(x: number): number {
    return x * (1 - x);
  }

  public predict(inputs: number[]): number[] {
    // Hidden layer
    const hidden = this.bias1.map((b, j) => {
      const sum = inputs.reduce((acc, val, i) => acc + val * this.weights1[i][j], b);
      return this.sigmoid(sum);
    });

    // Output layer
    const outputs = this.bias2.map((b, k) => {
      const sum = hidden.reduce((acc, val, j) => acc + val * this.weights2[j][k], b);
      return this.sigmoid(sum);
    });

    return outputs;
  }

  public train(inputs: number[], targets: number[]): void {
    // Forward pass
    const hidden = this.bias1.map((b, j) => {
      const sum = inputs.reduce((acc, val, i) => acc + val * this.weights1[i][j], b);
      return this.sigmoid(sum);
    });

    const outputs = this.bias2.map((b, k) => {
      const sum = hidden.reduce((acc, val, j) => acc + val * this.weights2[j][k], b);
      return this.sigmoid(sum);
    });

    // Backward pass
    // Calculate output layer errors and gradients
    const outputErrors = targets.map((t, k) => t - outputs[k]);
    const outputGradients = outputs.map((o, k) => outputErrors[k] * this.sigmoidDerivative(o));

    // Calculate hidden layer errors and gradients
    const hiddenErrors = hidden.map((_, j) => {
      return outputGradients.reduce((acc, grad, k) => acc + grad * this.weights2[j][k], 0);
    });
    const hiddenGradients = hidden.map((h, j) => hiddenErrors[j] * this.sigmoidDerivative(h));

    // Update weights2 and bias2
    for (let j = 0; j < this.hiddenSize; j++) {
      for (let k = 0; k < this.outputSize; k++) {
        this.weights2[j][k] += hidden[j] * outputGradients[k] * this.learningRate;
      }
    }
    for (let k = 0; k < this.outputSize; k++) {
      this.bias2[k] += outputGradients[k] * this.learningRate;
    }

    // Update weights1 and bias1
    for (let i = 0; i < this.inputSize; i++) {
      for (let j = 0; j < this.hiddenSize; j++) {
        this.weights1[i][j] += inputs[i] * hiddenGradients[j] * this.learningRate;
      }
    }
    for (let j = 0; j < this.hiddenSize; j++) {
      this.bias1[j] += hiddenGradients[j] * this.learningRate;
    }
  }
}
