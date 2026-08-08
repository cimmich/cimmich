export class PossiblePeopleUnionFind {
  constructor() {
    this.parent = new Map();
  }

  add(value) {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value) {
    let root = this.parent.get(value);
    while (root !== this.parent.get(root)) root = this.parent.get(root);
    let current = value;
    while (current !== root) {
      const next = this.parent.get(current);
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(left, right) {
    this.add(left);
    this.add(right);
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot);
  }
}
