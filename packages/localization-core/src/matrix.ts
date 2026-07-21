export type Matrix = number[][];

export function zeros(rows: number, columns: number): Matrix {
  return Array.from({ length: rows }, () => Array(columns).fill(0));
}

export function identity(size: number): Matrix {
  const result = zeros(size, size);
  for (let index = 0; index < size; index += 1) result[index][index] = 1;
  return result;
}

export function transpose(matrix: Matrix): Matrix {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

export function multiply(left: Matrix, right: Matrix): Matrix {
  const result = zeros(left.length, right[0].length);
  for (let row = 0; row < left.length; row += 1) {
    for (let column = 0; column < right[0].length; column += 1) {
      for (let inner = 0; inner < right.length; inner += 1) {
        result[row][column] += left[row][inner] * right[inner][column];
      }
    }
  }
  return result;
}

export function add(left: Matrix, right: Matrix): Matrix {
  return left.map((row, rowIndex) =>
    row.map((value, columnIndex) => value + right[rowIndex][columnIndex]),
  );
}

export function subtract(left: Matrix, right: Matrix): Matrix {
  return left.map((row, rowIndex) =>
    row.map((value, columnIndex) => value - right[rowIndex][columnIndex]),
  );
}

export function multiplyVector(matrix: Matrix, vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

export function inverse2x2(matrix: Matrix): Matrix {
  const determinant = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
  if (Math.abs(determinant) < 1e-12) throw new Error('Innovation covariance is singular.');
  return [
    [matrix[1][1] / determinant, -matrix[0][1] / determinant],
    [-matrix[1][0] / determinant, matrix[0][0] / determinant],
  ];
}
